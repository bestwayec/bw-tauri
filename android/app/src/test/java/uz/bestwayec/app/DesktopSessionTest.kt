package uz.bestwayec.app

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DesktopSessionTest {
    private fun response(access: String = "synthetic.jwt.signature", refresh: String = "synthetic_refresh"): JSONObject =
        JSONObject().put("success", true).put("data", JSONObject()
            .put("accessToken", access)
            .put("refreshToken", refresh)
            .put("user", JSONObject().put("role", "student")))

    @Test
    fun djangoExchangeProducesTheWebsiteSessionCookies() {
        val session = requireNotNull(DesktopSession.fromExchange(response()))
        assertEquals(listOf(
            "bw_at=synthetic.jwt.signature; Path=/; Max-Age=900; Secure; HttpOnly; SameSite=Lax",
            "bw_rt=synthetic_refresh; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax",
            "bw_role=student; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax",
        ), session.websiteCookies())
    }

    @Test
    fun incompleteOrMalformedExchangeCannotSetSessionCookies() {
        assertNull(DesktopSession.fromExchange(response().put("success", false)))
        assertNull(DesktopSession.fromExchange(JSONObject().put("accessToken", "legacy")))
        assertNull(DesktopSession.fromExchange(response(refresh = "")))
        assertNull(DesktopSession.fromExchange(response(access = "invalid; Domain=other.test")))
    }
}
