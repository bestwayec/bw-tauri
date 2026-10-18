package uz.bestwayec.app

import android.Manifest
import android.app.Activity
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
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
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import android.graphics.Color
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder

class MainActivity : AppCompatActivity() {

    companion object {
        private const val BASE_URL = "https://bestwayec.uz/?platform=mobile_app"
        private const val USER_AGENT_SUFFIX = " BestWayApp/0.8.2 BestWay-Android/0.8.2 MobileApp"
        private const val REQUEST_RECORD_AUDIO = 1001
    }

    class AndroidBridge {
        @android.webkit.JavascriptInterface
        fun isMobileApp(): Boolean = true

        @android.webkit.JavascriptInterface
        fun getVersion(): String = "0.8.2"
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
                    else -> grantedResources.add(res)
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

        if (savedInstanceState == null) {
            val deepLinkUri = intent?.data
            val scheme = deepLinkUri?.scheme?.lowercase()
            if (deepLinkUri != null && (scheme == "bestway-exam" || scheme == "bestway")) {
                handleDeepLink(intent)
            } else {
                webView.loadUrl(BASE_URL)
            }
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
        if (scheme == "bestway-exam" || scheme == "bestway") {
            val path = data.path ?: ""
            if (path == "/auth/callback" || path.endsWith("/auth/callback")) {
                val code = data.getQueryParameter("code")
                val token = data.getQueryParameter("token")
                val targetParam = when {
                    !code.isNullOrEmpty() -> "auth_code=$code"
                    !token.isNullOrEmpty() -> "token=$token"
                    else -> null
                }
                val redirectUrl = if (targetParam != null) {
                    "https://bestwayec.uz/?$targetParam"
                } else {
                    "https://bestwayec.uz/?platform=mobile_app"
                }
                webView.loadUrl(redirectUrl)
            }
        }
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
            setCookie("https://bestwayec.uz", "bw_mobile_app=1; path=/; max-age=31536000")
        }

        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        webView.addJavascriptInterface(AndroidBridge(), "AndroidBridge")

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = true
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
                runOnUiThread {
                    val requestedResources = request.resources
                    val neededPermissions = mutableListOf<String>()

                    for (resource in requestedResources) {
                        when (resource) {
                            PermissionRequest.RESOURCE_AUDIO_CAPTURE -> {
                                if (ContextCompat.checkSelfPermission(
                                        this@MainActivity,
                                        Manifest.permission.RECORD_AUDIO
                                    ) != PackageManager.PERMISSION_GRANTED
                                ) {
                                    neededPermissions.add(Manifest.permission.RECORD_AUDIO)
                                }
                            }
                            PermissionRequest.RESOURCE_VIDEO_CAPTURE -> {
                                if (ContextCompat.checkSelfPermission(
                                        this@MainActivity,
                                        Manifest.permission.CAMERA
                                    ) != PackageManager.PERMISSION_GRANTED
                                ) {
                                    neededPermissions.add(Manifest.permission.CAMERA)
                                }
                            }
                        }
                    }

                    if (neededPermissions.isEmpty()) {
                        request.grant(requestedResources)
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
                } catch (e: ActivityNotFoundException) {
                    fileUploadCallback?.onReceiveValue(null)
                    fileUploadCallback = null
                    false
                }
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString()
                return handleUrl(url) || super.shouldOverrideUrlLoading(view, request)
            }

            @Suppress("DEPRECATION")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                return handleUrl(url) || super.shouldOverrideUrlLoading(view, url)
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

    private fun handleUrl(url: String?): Boolean {
        if (url == null) return false
        val uri = Uri.parse(url)
        val scheme = uri.scheme?.lowercase() ?: ""

        if (url.contains("accounts.google.com") || url.contains("oauth2.googleapis.com")) {
            return try {
                val intent = Intent(Intent.ACTION_VIEW, uri)
                startActivity(intent)
                true
            } catch (e: Exception) {
                false
            }
        }

        if (scheme == "bestway-exam" || scheme == "bestway") {
            handleDeepLink(Intent(Intent.ACTION_VIEW, uri))
            return true
        }

        if (scheme == "tel" || scheme == "mailto" || scheme == "tg" ||
            url.startsWith("https://t.me/") || url.startsWith("http://t.me/") ||
            (scheme != "http" && scheme != "https")
        ) {
            return try {
                val intent = Intent(Intent.ACTION_VIEW, uri)
                startActivity(intent)
                true
            } catch (e: Exception) {
                false
            }
        }
        return false
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
