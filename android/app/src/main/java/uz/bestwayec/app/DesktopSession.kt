package uz.bestwayec.app

import org.json.JSONObject

internal class DesktopSession private constructor(
    private val access: String,
    private val refresh: String,
    private val role: String,
) {
    fun websiteCookies(): List<String> = listOf(
        cookie("bw_at", access, 15 * 60),
        cookie("bw_rt", refresh, 30 * 24 * 60 * 60),
        cookie("bw_role", role, 30 * 24 * 60 * 60),
    )

    companion object {
        private val token = Regex("[A-Za-z0-9._~+/=-]+")
        private val desktopRoles = setOf("student", "teacher", "admin", "super_admin")

        private fun cookie(name: String, value: String, maxAge: Int): String =
            "$name=$value; Path=/; Max-Age=$maxAge; Secure; HttpOnly; SameSite=Lax"

        fun fromExchange(response: JSONObject): DesktopSession? {
            if (!response.optBoolean("success")) return null
            val data = response.optJSONObject("data") ?: return null
            val access = data.opt("accessToken") as? String ?: return null
            val refresh = data.opt("refreshToken") as? String ?: return null
            val role = data.optJSONObject("user")?.opt("role") as? String ?: return null
            if (!token.matches(access) || !token.matches(refresh) || role !in desktopRoles) return null
            return DesktopSession(access, refresh, role)
        }
    }
}
