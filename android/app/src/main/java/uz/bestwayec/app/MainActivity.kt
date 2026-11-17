package uz.bestwayec.app

import android.Manifest
import android.app.Activity
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID

class MainActivity : AppCompatActivity() {

    companion object {
        const val BASE_URL = "https://bestwayec.uz/?platform=mobile_app"
        const val API_BASE_URL = "https://api.bestwayec.uz/v1"
        const val APP_VERSION = "1.0.12"
        private val TRUSTED_HOSTS = setOf("bestwayec.uz", "api.bestwayec.uz")
        private val USER_AGENT_SUFFIX = " BestWayApp/$APP_VERSION BestWay-Android/$APP_VERSION MobileApp"
        private const val REQUEST_RECORD_AUDIO = 1001

        /**
         * Validates whether a URL or origin belongs strictly to an approved HTTPS host.
         * Cleartext HTTP is never trusted.
         */
        fun isTrustedOrigin(urlOrOrigin: String?): Boolean {
            if (urlOrOrigin.isNullOrBlank()) return false
            return try {
                val uri = Uri.parse(urlOrOrigin)
                val scheme = uri.scheme?.lowercase()
                val host = uri.host?.lowercase()
                scheme == "https" && host != null && TRUSTED_HOSTS.contains(host)
            } catch (_: Exception) {
                false
            }
        }
    }

    /**
     * Minimal, hardened JavaScript interface.
     * Exposes environment metadata and safe OAuth initiation triggers.
     * Never exposes access tokens, refresh tokens, or raw secrets.
     */
    class AndroidBridge(private val activity: MainActivity, private val webView: WebView) {
        @android.webkit.JavascriptInterface
        fun isMobileApp(): Boolean {
            val url = webView.url ?: ""
            return isTrustedOrigin(url)
        }

        @android.webkit.JavascriptInterface
        fun getVersion(): String {
            val url = webView.url ?: ""
            if (!isTrustedOrigin(url)) return ""
            return APP_VERSION
        }

        @android.webkit.JavascriptInterface
        fun startOAuthLogin(provider: String?) {
            val url = webView.url ?: ""
            if (!isTrustedOrigin(url)) return
            activity.runOnUiThread {
                activity.initiateOAuthLogin(provider)
            }
        }
    }

    data class OAuthPendingSession(
        val state: String,
        val verifier: String,
        val deviceId: String,
        val createdAt: Long
    )

    /**
     * PKCE & State Security Manager for OAuth flows.
     * Generates local state + verifier with S256 code challenge, persists across
     * process recreation via SharedPreferences, enforces strict TTL and single-use consumption.
     */
    object OAuthSecurityManager {
        const val STATE_TTL_MS = 5 * 60 * 1000L // 5 minutes
        private const val PREFS_NAME = "uz.bestwayec.app.oauth_state"
        private const val KEY_STATE = "oauth_pending_state"
        private const val KEY_VERIFIER = "oauth_pending_verifier"
        private const val KEY_DEVICE_ID = "oauth_device_id"
        private const val KEY_CREATED_AT = "oauth_created_at"

        @Volatile
        private var memorySession: OAuthPendingSession? = null

        @Synchronized
        fun getOrCreateDeviceId(context: Context?): String {
            if (context == null) return "android-client"
            return try {
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                var deviceId = prefs.getString(KEY_DEVICE_ID, null)
                if (deviceId.isNullOrBlank()) {
                    deviceId = "android-" + UUID.randomUUID().toString()
                    prefs.edit().putString(KEY_DEVICE_ID, deviceId).apply()
                }
                deviceId
            } catch (_: Exception) {
                "android-client"
            }
        }

        @Synchronized
        fun createPendingLogin(context: Context?): OAuthPendingSession {
            val stateBytes = ByteArray(16)
            val verifierBytes = ByteArray(32)
            val rng = SecureRandom()
            rng.nextBytes(stateBytes)
            rng.nextBytes(verifierBytes)

            val state = stateBytes.joinToString("") { "%02x".format(it) }
            val verifier = verifierBytes.joinToString("") { "%02x".format(it) }
            val deviceId = getOrCreateDeviceId(context)
            val now = System.currentTimeMillis()

            val session = OAuthPendingSession(
                state = state,
                verifier = verifier,
                deviceId = deviceId,
                createdAt = now
            )

            // Persist to private SharedPreferences so it survives Android process death/recreation
            if (context != null) {
                try {
                    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                        .putString(KEY_STATE, state)
                        .putString(KEY_VERIFIER, verifier)
                        .putLong(KEY_CREATED_AT, now)
                        .apply()
                } catch (_: Exception) {}
            }

            memorySession = session
            return session
        }

        @Synchronized
        fun generateCodeChallenge(verifier: String): String {
            val bytes = verifier.toByteArray(Charsets.US_ASCII)
            val md = MessageDigest.getInstance("SHA-256")
            val digest = md.digest(bytes)
            return try {
                val clazz = Class.forName("android.util.Base64")
                val method = clazz.getMethod("encodeToString", ByteArray::class.java, Int::class.javaPrimitiveType)
                // URL_SAFE = 8, NO_PADDING = 1, NO_WRAP = 2 -> 11
                (method.invoke(null, digest, 11) as String).trim()
            } catch (_: Exception) {
                java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(digest).trim()
            }
        }

        fun buildAuthorizeUrl(context: Context?, provider: String? = null): String {
            val session = createPendingLogin(context)
            val challenge = generateCodeChallenge(session.verifier)

            val desktopParams = Uri.Builder()
                .appendQueryParameter("device", "android")
                .appendQueryParameter("state", session.state)
                .appendQueryParameter("code_challenge", challenge)
                .appendQueryParameter("code_challenge_method", "S256")
                .appendQueryParameter("redirect", "bestwayapp://auth/callback")
                .build()
                .query ?: ""

            val nextPath = "/oauth/desktop?$desktopParams"
            val builder = Uri.parse("https://bestwayec.uz/login").buildUpon()
                .appendQueryParameter("next", nextPath)
                .appendQueryParameter("platform", "mobile_app")

            if (!provider.isNullOrBlank()) {
                builder.appendQueryParameter("provider", provider)
            }

            return builder.build().toString()
        }

        /**
         * Validates incoming OAuth callback state against locally initiated attempt.
         * Single-use: once verified, state is wiped from both storage and memory to prevent replay attacks.
         */
        @Synchronized
        fun validateAndConsumeState(context: Context?, state: String?): OAuthPendingSession? {
            if (state.isNullOrBlank()) return null

            val prefs = try {
                context?.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            } catch (_: Exception) { null }

            val storedState = prefs?.getString(KEY_STATE, null) ?: memorySession?.state
            val storedVerifier = prefs?.getString(KEY_VERIFIER, null) ?: memorySession?.verifier
            val storedCreatedAt = if (prefs != null && prefs.contains(KEY_CREATED_AT)) {
                prefs.getLong(KEY_CREATED_AT, 0L)
            } else {
                memorySession?.createdAt ?: 0L
            }
            val deviceId = getOrCreateDeviceId(context)

            // Always wipe immediately to prevent replay attacks
            clear(context)

            if (storedState.isNullOrBlank() || storedVerifier.isNullOrBlank()) {
                return null
            }

            if (storedState != state) {
                return null
            }

            if (System.currentTimeMillis() - storedCreatedAt > STATE_TTL_MS) {
                return null
            }

            return OAuthPendingSession(
                state = storedState,
                verifier = storedVerifier,
                deviceId = deviceId,
                createdAt = storedCreatedAt
            )
        }

        @Synchronized
        fun clear(context: Context?) {
            memorySession = null
            if (context != null) {
                try {
                    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                        .remove(KEY_STATE)
                        .remove(KEY_VERIFIER)
                        .remove(KEY_CREATED_AT)
                        .apply()
                } catch (_: Exception) {}
            }
        }
    }

    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var offlineLayout: View
    private lateinit var btnRetry: MaterialButton

    private var hasError = false
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermissionRequest: PermissionRequest? = null

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { _ ->
        val currentPending = pendingPermissionRequest
        if (currentPending != null) {
            val grantedResources = mutableListOf<String>()
            for (res in currentPending.resources) {
                when (res) {
                    PermissionRequest.RESOURCE_AUDIO_CAPTURE -> {
                        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                            grantedResources.add(res)
                        }
                    }
                    PermissionRequest.RESOURCE_VIDEO_CAPTURE -> {
                        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                            grantedResources.add(res)
                        }
                    }
                    // Reject all other resource types (fail-closed)
                }
            }
            if (grantedResources.isNotEmpty()) {
                currentPending.grant(grantedResources.toTypedArray())
            } else {
                currentPending.deny()
            }
            pendingPermissionRequest = null
        }
    }

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val intent = result.data
            val results: Array<Uri>? = when {
                intent?.data != null -> arrayOf(intent.data!!)
                intent?.clipData != null -> {
                    val clipData = intent.clipData!!
                    Array(clipData.itemCount) { i -> clipData.getItemAt(i).uri }
                }
                else -> null
            }
            fileUploadCallback?.onReceiveValue(results)
        } else {
            fileUploadCallback?.onReceiveValue(null)
        }
        fileUploadCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        applySystemBars()

        initViews()
        setupWebView()
        setupListeners()
        setupBackNavigation()
        requestAudioPermission()

        val deepLinkUri = intent?.data
        val scheme = deepLinkUri?.scheme?.lowercase()
        if (deepLinkUri != null && (scheme == "bestway-exam" || scheme == "bestway" || scheme == "bestwayapp")) {
            handleDeepLink(intent)
        } else if (savedInstanceState == null) {
            webView.loadUrl(BASE_URL)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleDeepLink(intent)
    }

    private fun handleDeepLink(intent: Intent?) {
        val data = intent?.data ?: return
        val scheme = data.scheme?.lowercase() ?: return
        if (scheme != "bestway-exam" && scheme != "bestway" && scheme != "bestwayapp") {
            return
        }

        val host = data.host?.lowercase() ?: ""
        val path = data.path ?: ""
        val fullUrl = data.toString()
        val isAuthCallback = (host == "auth" && (path == "/callback" || path.isEmpty())) ||
            path == "/auth/callback" ||
            path.endsWith("/auth/callback") ||
            fullUrl.contains("/auth/callback")

        if (!isAuthCallback) {
            return
        }

        val state = data.getQueryParameter("state")
        val code = data.getQueryParameter("code")

        // Mandatory CSRF state verification with PKCE verifier retrieval
        val pendingSession = OAuthSecurityManager.validateAndConsumeState(this, state)
        if (pendingSession == null) {
            Toast.makeText(this, "Xavfsizlik xatosi: Yaroqsiz yoki muddati o'tgan OAuth holati", Toast.LENGTH_LONG).show()
            return
        }

        if (code.isNullOrBlank()) {
            Toast.makeText(this, "Avtorizatsiya kodi topilmadi", Toast.LENGTH_SHORT).show()
            return
        }

        // Exchange authorization code for authenticated session using matching verifier
        performCodeExchange(code, pendingSession.verifier, pendingSession.deviceId)
    }

    private fun performCodeExchange(code: String, verifier: String, deviceId: String) {
        progressBar.visibility = View.VISIBLE

        Thread {
            var success = false
            var errorMessage: String? = null
            var accessToken: String? = null

            try {
                val url = URL("$API_BASE_URL/auth/desktop/exchange")
                val connection = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 15000
                    readTimeout = 15000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("User-Agent", webView.settings.userAgentString)
                }

                val payload = JSONObject().apply {
                    put("code", code)
                    put("verifier", verifier)
                    put("deviceId", deviceId)
                }

                OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { writer ->
                    writer.write(payload.toString())
                    writer.flush()
                }

                val responseCode = connection.responseCode
                if (responseCode in 200..299) {
                    val responseText = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                    val json = JSONObject(responseText)
                    accessToken = json.optString("accessToken").ifEmpty { json.optString("token") }
                    if (!accessToken.isNullOrBlank()) {
                        success = true
                    } else {
                        errorMessage = "Server javobida token topilmadi"
                    }
                } else {
                    val errorText = try {
                        connection.errorStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
                    } catch (_: Exception) { null }
                    errorMessage = try {
                        val errJson = if (errorText != null) JSONObject(errorText) else null
                        val nested = errJson?.optJSONObject("error")
                        nested?.optString("message") ?: errJson?.optString("message") ?: "Server xatosi: $responseCode"
                    } catch (_: Exception) {
                        "Server xatosi: $responseCode"
                    }
                }
            } catch (e: Exception) {
                errorMessage = "Tarmoq xatosi: ${e.localizedMessage ?: "Server bilan aloqa o'rnatib bo'lmadi"}"
            }

            runOnUiThread {
                progressBar.visibility = View.GONE
                if (success && !accessToken.isNullOrBlank()) {
                    val cookieManager = CookieManager.getInstance()
                    cookieManager.setAcceptCookie(true)
                    cookieManager.setAcceptThirdPartyCookies(webView, true)
                    val domain = "https://bestwayec.uz"
                    cookieManager.setCookie(domain, "token=$accessToken; path=/; max-age=2592000; Secure; SameSite=Lax")
                    cookieManager.setCookie(domain, "access_token=$accessToken; path=/; max-age=2592000; Secure; SameSite=Lax")
                    cookieManager.setCookie(domain, "bw_mobile_app=1; path=/; max-age=31536000; Secure; SameSite=Lax")
                    cookieManager.setCookie("https://api.bestwayec.uz", "token=$accessToken; path=/; max-age=2592000; Secure; SameSite=Lax")
                    cookieManager.flush()

                    Toast.makeText(this@MainActivity, "Muvaffaqiyatli tizimga kirildi", Toast.LENGTH_SHORT).show()
                    webView.loadUrl(BASE_URL)
                } else {
                    val msg = errorMessage ?: "Avtorizatsiyadan o'tishda xatolik yuz berdi"
                    Toast.makeText(this@MainActivity, msg, Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    fun initiateOAuthLogin(provider: String? = null) {
        try {
            val authUrl = OAuthSecurityManager.buildAuthorizeUrl(this, provider)
            openCustomTabOrBrowser(Uri.parse(authUrl))
        } catch (e: Exception) {
            Toast.makeText(this, "Kirishni boshlashda xatolik: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun handleLogout() {
        val cookieManager = CookieManager.getInstance()
        cookieManager.removeAllCookies(null)
        cookieManager.flush()

        OAuthSecurityManager.clear(this)

        webView.evaluateJavascript(
            """
            (function() {
                try {
                    localStorage.clear();
                    sessionStorage.clear();
                } catch (e) {}
            })();
            """.trimIndent(),
            null
        )
    }

    private fun initViews() {
        swipeRefresh = findViewById(R.id.swipeRefresh)
        webView = findViewById(R.id.webView)
        progressBar = findViewById(R.id.progressBar)
        offlineLayout = findViewById(R.id.offlineLayout)
        btnRetry = findViewById(R.id.btnRetry)

        swipeRefresh.setColorSchemeResources(R.color.primary, R.color.accent)
    }

    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
            setCookie("https://bestwayec.uz", "bw_mobile_app=1; path=/; max-age=31536000; Secure; SameSite=Lax")
        }

        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        webView.addJavascriptInterface(AndroidBridge(this, webView), "AndroidBridge")

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = "${userAgentString}$USER_AGENT_SUFFIX"
            useWideViewPort = true
            loadWithOverviewMode = true
            @Suppress("DEPRECATION")
            setRenderPriority(WebSettings.RenderPriority.HIGH)
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                if (request == null) return
                val origin = request.origin?.toString() ?: ""

                // Origin verification: Only approved HTTPS origin can request device hardware
                if (!isTrustedOrigin(origin)) {
                    request.deny()
                    return
                }

                runOnUiThread {
                    val requestedResources = request.resources
                    val neededPermissions = mutableListOf<String>()
                    val validResources = mutableListOf<String>()

                    for (resource in requestedResources) {
                        when (resource) {
                            PermissionRequest.RESOURCE_AUDIO_CAPTURE -> {
                                validResources.add(resource)
                                if (ContextCompat.checkSelfPermission(
                                        this@MainActivity,
                                        Manifest.permission.RECORD_AUDIO
                                    ) != PackageManager.PERMISSION_GRANTED
                                ) {
                                    neededPermissions.add(Manifest.permission.RECORD_AUDIO)
                                }
                            }
                            PermissionRequest.RESOURCE_VIDEO_CAPTURE -> {
                                validResources.add(resource)
                                if (ContextCompat.checkSelfPermission(
                                        this@MainActivity,
                                        Manifest.permission.CAMERA
                                    ) != PackageManager.PERMISSION_GRANTED
                                ) {
                                    neededPermissions.add(Manifest.permission.CAMERA)
                                }
                            }
                            // Reject all other resource types
                        }
                    }

                    if (validResources.isEmpty()) {
                        request.deny()
                        return@runOnUiThread
                    }

                    if (neededPermissions.isEmpty()) {
                        request.grant(validResources.toTypedArray())
                    } else {
                        pendingPermissionRequest = request
                        permissionLauncher.launch(neededPermissions.toTypedArray())
                    }
                }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest?) {
                super.onPermissionRequestCanceled(request)
                if (pendingPermissionRequest == request) {
                    pendingPermissionRequest = null
                }
            }

            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                super.onProgressChanged(view, newProgress)
                if (newProgress < 100) {
                    progressBar.visibility = View.VISIBLE
                    progressBar.progress = newProgress
                } else {
                    progressBar.visibility = View.GONE
                }
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                fileUploadCallback?.onReceiveValue(null)
                fileUploadCallback = filePathCallback

                val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                }

                return try {
                    fileChooserLauncher.launch(intent)
                    true
                } catch (_: ActivityNotFoundException) {
                    fileUploadCallback?.onReceiveValue(null)
                    fileUploadCallback = null
                    false
                }
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString()
                return handleUrl(url)
            }

            @Suppress("DEPRECATION")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                return handleUrl(url)
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                hasError = false
                checkExamMode(url)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                swipeRefresh.isRefreshing = false
                if (!hasError) {
                    hideOffline()
                }
                checkExamMode(url)
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    hasError = true
                    showOffline()
                }
            }

            @Suppress("DEPRECATION")
            override fun onReceivedError(
                view: WebView?,
                errorCode: Int,
                description: String?,
                failingUrl: String?
            ) {
                super.onReceivedError(view, errorCode, description, failingUrl)
                hasError = true
                showOffline()
            }

            override fun doUpdateVisitedHistory(view: WebView?, url: String?, isReload: Boolean) {
                super.doUpdateVisitedHistory(view, url, isReload)
                checkExamMode(url)
            }
        }

        webView.setDownloadListener { url, userAgent, contentDisposition, mimetype, _ ->
            try {
                val request = DownloadManager.Request(Uri.parse(url)).apply {
                    setMimeType(mimetype)
                    addRequestHeader("User-Agent", userAgent)
                    val cookies = CookieManager.getInstance().getCookie(url)
                    if (cookies != null) {
                        addRequestHeader("Cookie", cookies)
                    }
                    val fileName = URLUtil.guessFileName(url, contentDisposition, mimetype)
                    setTitle(fileName)
                    setDescription(fileName)
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
                }
                val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                dm.enqueue(request)
                Toast.makeText(this, "Yuklab olish boshlandi", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this, "Yuklab olishda xatolik: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun openCustomTabOrBrowser(uri: Uri): Boolean {
        return try {
            val customTabsIntent = CustomTabsIntent.Builder()
                .setShowTitle(true)
                .build()
            customTabsIntent.launchUrl(this, uri)
            true
        } catch (_: Exception) {
            try {
                val intent = Intent(Intent.ACTION_VIEW, uri)
                startActivity(intent)
                true
            } catch (_: Exception) {
                false
            }
        }
    }

    /**
     * Intercepts and controls all navigations.
     * Enforces origin boundary: only verified HTTPS origins (bestwayec.uz / api.bestwayec.uz)
     * may load inside the privileged WebView. All untrusted external links are routed outside.
     */
    private fun handleUrl(url: String?): Boolean {
        if (url == null) return true
        val uri = try {
            Uri.parse(url)
        } catch (_: Exception) {
            return true
        }
        val scheme = uri.scheme?.lowercase() ?: ""

        // 1. In-app OAuth Deep Links
        if (scheme == "bestway-exam" || scheme == "bestway" || scheme == "bestwayapp") {
            handleDeepLink(Intent(Intent.ACTION_VIEW, uri))
            return true
        }

        // 2. OAuth Initiation Interception:
        // When navigating to external OAuth identity providers or in-app OAuth initiation endpoints,
        // locally create a PKCE-S256 login attempt with bound state & verifier, then launch in Custom Tab.
        if (url.contains("accounts.google.com") || url.contains("oauth2.googleapis.com") ||
            (isTrustedOrigin(url) && (uri.path?.contains("/oauth/desktop") == true || uri.path?.contains("/auth/google") == true))) {
            val provider = if (url.contains("google")) "google" else null
            initiateOAuthLogin(provider)
            return true
        }

        // 3. Known external communication schemes
        if (scheme == "tel" || scheme == "mailto" || scheme == "tg" ||
            url.startsWith("https://t.me/") || url.startsWith("http://t.me/") ||
            (scheme != "http" && scheme != "https")
        ) {
            return try {
                val intent = Intent(Intent.ACTION_VIEW, uri)
                startActivity(intent)
                true
            } catch (_: Exception) {
                true
            }
        }

        // 4. HTTPS Navigation: Strict Trusted Origin Boundary
        if (scheme == "https") {
            val host = uri.host?.lowercase() ?: ""
            if (TRUSTED_HOSTS.contains(host)) {
                val path = uri.path?.lowercase() ?: ""
                if (path == "/logout" || path == "/auth/logout" || path == "/account/logout") {
                    handleLogout()
                }
                // Allowed within privileged WebView
                return false
            }
        }

        // 5. Untrusted external origin: Route outside privileged WebView
        openCustomTabOrBrowser(uri)
        return true
    }

    private fun isCurrentExam(url: String? = webView.url): Boolean {
        if (url == null) return false
        return url.contains("/mock/run") ||
            url.contains("/mock/attempt") ||
            url.contains("/attempt/") ||
            url.contains("/runner") ||
            url.contains("/exam") ||
            url.contains("/student/exam") ||
            url.contains("/multilevel")
    }

    /** Pull-to-refresh is limited to the dashboard so it can never reload an exam or a form mid-edit. */
    private fun isDashboard(url: String?): Boolean {
        if (url == null) return false
        val path = Uri.parse(url).path ?: return false
        return path.endsWith("/dashboard") || path.endsWith("/dashboard/")
    }

    /** Status/navigation bars match the app canvas (#0B0F17) with light icons. */
    private fun applySystemBars() {
        val canvas = Color.parseColor("#0B0F17")
        window.statusBarColor = canvas
        window.navigationBarColor = canvas
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
    }

    private fun checkExamMode(url: String?) {
        val isExam = isCurrentExam(url)
        if (isExam) {
            window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
        swipeRefresh.isEnabled = !isExam && isDashboard(url)
    }

    private fun setupListeners() {
        swipeRefresh.setOnRefreshListener {
            webView.reload()
        }

        btnRetry.setOnClickListener {
            hideOffline()
            swipeRefresh.isRefreshing = true
            webView.reload()
        }
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (isCurrentExam()) {
                    showExitExamDialog()
                } else if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    showExitDialog()
                }
            }
        })
    }

    private fun showExitExamDialog() {
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.exit_exam_title)
            .setMessage(R.string.exit_exam_msg)
            .setPositiveButton(R.string.yes) { _, _ ->
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    finish()
                }
            }
            .setNegativeButton(R.string.no, null)
            .show()
    }

    private fun showExitDialog() {
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.exit_title)
            .setMessage(R.string.exit_msg)
            .setPositiveButton(R.string.yes) { _, _ -> finish() }
            .setNegativeButton(R.string.no, null)
            .show()
    }

    private fun showOffline() {
        offlineLayout.visibility = View.VISIBLE
        swipeRefresh.visibility = View.GONE
        swipeRefresh.isRefreshing = false
        progressBar.visibility = View.GONE
    }

    private fun hideOffline() {
        offlineLayout.visibility = View.GONE
        swipeRefresh.visibility = View.VISIBLE
    }

    private fun requestAudioPermission() {
        val permissions = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.RECORD_AUDIO)
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.MODIFY_AUDIO_SETTINGS) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.MODIFY_AUDIO_SETTINGS)
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.CAMERA)
        }
        if (permissions.isNotEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                permissions.toTypedArray(),
                REQUEST_RECORD_AUDIO
            )
        }
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onRestoreInstanceState(savedInstanceState: Bundle) {
        super.onRestoreInstanceState(savedInstanceState)
        webView.restoreState(savedInstanceState)
    }
}
