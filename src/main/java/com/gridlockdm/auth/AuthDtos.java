package com.gridlockdm.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** DTOs for auth endpoints — kept in one file for brevity at scaffold stage. */
public final class AuthDtos {

    private AuthDtos() {}

    // ── Requests ──────────────────────────────────────────────────────────────

    public record RegisterRequest(
            @Email(message = "Must be a valid email address")
            @NotBlank
            String email,

            @NotBlank
            @Size(min = 2, max = 100, message = "Display name must be 2–100 characters")
            String displayName,

            @NotBlank
            @Size(min = 8, message = "Password must be at least 8 characters")
            String password
    ) {}

    public record LoginRequest(
            @Email @NotBlank String email,
            @NotBlank         String password
    ) {}

    // ── Responses ─────────────────────────────────────────────────────────────

    public record AuthResponse(
            String  token,
            String  tokenType,     // always "Bearer"
            long    expiresIn,     // milliseconds
            UserSummary user
    ) {
        public static AuthResponse of(String token, long expiresIn, UserSummary user) {
            return new AuthResponse(token, "Bearer", expiresIn, user);
        }
    }

    public record UserSummary(
            String id,
            String email,
            String displayName,
            String avatarUrl,
            String role
    ) {}
}
