package uz.bestwayec.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class OAuthSecurityManagerTest {

    @Before
    fun setUp() {
        MainActivity.OAuthSecurityManager.clear(null)
    }

    @Test
    fun testCreatePendingLoginGeneratesCryptographicTokens() {
        val session1 = MainActivity.OAuthSecurityManager.createPendingLogin(null)
        val session2 = MainActivity.OAuthSecurityManager.createPendingLogin(null)

        assertNotNull(session1.state)
        assertEquals(32, session1.state.length) // 16 bytes hex

        assertNotNull(session1.verifier)
        assertEquals(64, session1.verifier.length) // 32 bytes hex

        // Must generate unique tokens per login invocation
        assertFalse(session1.state == session2.state)
        assertFalse(session1.verifier == session2.verifier)
    }

    @Test
    fun testGenerateCodeChallengeRFC7636Format() {
        val verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        val challenge = MainActivity.OAuthSecurityManager.generateCodeChallenge(verifier)

        assertNotNull(challenge)
        assertTrue("Challenge must not be empty", challenge.isNotEmpty())
        assertFalse("Challenge must not contain padding '='", challenge.contains("="))
        assertFalse("Challenge must not contain '+'", challenge.contains("+"))
        assertFalse("Challenge must not contain '/'", challenge.contains("/"))
    }

    @Test
    fun testBuildAuthorizeUrlContainsRequiredParams() {
        val authUrl = MainActivity.OAuthSecurityManager.buildAuthorizeUrl(null, "google")

        assertTrue("Must target bestwayec.uz/login", authUrl.startsWith("https://bestwayec.uz/login"))
        assertTrue("Must contain platform=mobile_app", authUrl.contains("platform=mobile_app"))
        assertTrue("Must contain provider=google", authUrl.contains("provider=google"))
        assertTrue("Must contain next with /oauth/desktop", authUrl.contains("next=%2Foauth%2Fdesktop"))
        assertTrue("Must specify code_challenge_method=S256", authUrl.contains("code_challenge_method%3DS256"))
        assertTrue("Must specify redirect scheme", authUrl.contains("redirect%3Dbestwayapp%3A%2F%2Fauth%2Fcallback"))
    }

    @Test
    fun testValidateAndConsumeStateSuccess() {
        val session = MainActivity.OAuthSecurityManager.createPendingLogin(null)
        val validated = MainActivity.OAuthSecurityManager.validateAndConsumeState(null, session.state)

        assertNotNull("Matching state must validate successfully", validated)
        assertEquals(session.state, validated?.state)
        assertEquals(session.verifier, validated?.verifier)
    }

    @Test
    fun testValidateAndConsumeStateSingleUseReplayPrevention() {
        val session = MainActivity.OAuthSecurityManager.createPendingLogin(null)

        val first = MainActivity.OAuthSecurityManager.validateAndConsumeState(null, session.state)
        assertNotNull("First consumption must succeed", first)

        val replay = MainActivity.OAuthSecurityManager.validateAndConsumeState(null, session.state)
        assertNull("Replay attempt must be rejected (single-use)", replay)
    }

    @Test
    fun testValidateAndConsumeStateRejectsInvalidState() {
        MainActivity.OAuthSecurityManager.createPendingLogin(null)

        val invalid = MainActivity.OAuthSecurityManager.validateAndConsumeState(null, "forged_state_12345")
        assertNull("Invalid state must be rejected", invalid)
    }

    @Test
    fun testValidateAndConsumeStateRejectsExpiredState() {
        val session = MainActivity.OAuthSecurityManager.createPendingLogin(null)

        // Simulate TTL expiry (> 5 minutes)
        val expiredSession = MainActivity.OAuthPendingSession(
            state = session.state,
            verifier = session.verifier,
            deviceId = session.deviceId,
            createdAt = System.currentTimeMillis() - (MainActivity.OAuthSecurityManager.STATE_TTL_MS + 1000L)
        )

        // Overwrite in-memory session directly to simulate aging
        val field = MainActivity.OAuthSecurityManager::class.java.getDeclaredField("memorySession")
        field.isAccessible = true
        field.set(MainActivity.OAuthSecurityManager, expiredSession)

        val result = MainActivity.OAuthSecurityManager.validateAndConsumeState(null, session.state)
        assertNull("Expired state must be rejected", result)
    }

    @Test
    fun testClearPurgesPendingSession() {
        val session = MainActivity.OAuthSecurityManager.createPendingLogin(null)
        MainActivity.OAuthSecurityManager.clear(null)

        val result = MainActivity.OAuthSecurityManager.validateAndConsumeState(null, session.state)
        assertNull("Cleared state must be rejected", result)
    }
}
