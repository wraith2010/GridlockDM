package com.gridlockdm.config;

import io.jsonwebtoken.*;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.util.Date;
import java.util.Map;
import java.util.UUID;

/**
 * Handles JWT creation and validation for:
 *  - Regular authenticated users (role = PLAYER / DM / ADMIN)
 *  - Observer tokens (role = OBSERVER, scoped to a session)
 */
@Slf4j
@Component
public class JwtTokenProvider {

    private static final String CLAIM_ROLE       = "role";
    private static final String CLAIM_SESSION_ID = "sessionId";
    private static final String CLAIM_DISPLAY    = "displayName";

    private final SecretKey key;
    private final long      expiryMs;
    private final long      observerExpiryMs;

    public JwtTokenProvider(
            @Value("${gridlock.jwt.secret}") String secret,
            @Value("${gridlock.jwt.expiry-ms}") long expiryMs,
            @Value("${gridlock.jwt.observer-expiry-ms}") long observerExpiryMs) {

        this.key              = Keys.hmacShaKeyFor(Decoders.BASE64.decode(
                java.util.Base64.getEncoder().encodeToString(secret.getBytes())));
        this.expiryMs         = expiryMs;
        this.observerExpiryMs = observerExpiryMs;
    }

    // ── Token creation ────────────────────────────────────────────────────────

    /** Standard user JWT, valid for configured expiry. */
    public String createUserToken(UUID userId, String email, String displayName, String role) {
        return Jwts.builder()
                .subject(userId.toString())
                .claim(CLAIM_ROLE, role)
                .claim(CLAIM_DISPLAY, displayName)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + expiryMs))
                .signWith(key)
                .compact();
    }

    /** Observer JWT scoped to a specific session, shorter expiry. */
    public String createObserverToken(UUID sessionId, String label) {
        return Jwts.builder()
                .subject("observer:" + sessionId)
                .claim(CLAIM_ROLE, "OBSERVER")
                .claim(CLAIM_SESSION_ID, sessionId.toString())
                .claim(CLAIM_DISPLAY, label)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + observerExpiryMs))
                .signWith(key)
                .compact();
    }

    // ── Token parsing ─────────────────────────────────────────────────────────

    public Claims parseToken(String token) {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    public boolean isValid(String token) {
        try {
            parseToken(token);
            return true;
        } catch (JwtException | IllegalArgumentException ex) {
            log.debug("Invalid JWT: {}", ex.getMessage());
            return false;
        }
    }

    public String getSubject(String token) {
        return parseToken(token).getSubject();
    }

    public String getRole(String token) {
        return (String) parseToken(token).get(CLAIM_ROLE);
    }

    public boolean isObserverToken(String token) {
        return "OBSERVER".equals(getRole(token));
    }

    /** Returns the session ID claim — only present in observer tokens. */
    public UUID getSessionId(String token) {
        Object raw = parseToken(token).get(CLAIM_SESSION_ID);
        return raw == null ? null : UUID.fromString((String) raw);
    }
}
