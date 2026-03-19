package com.gridlockdm.auth;

import com.gridlockdm.auth.AuthDtos.*;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import com.gridlockdm.domain.user.User;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    /**
     * POST /api/auth/register
     * Public — creates a new player account and returns a JWT.
     */
    @PostMapping("/register")
    public ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(authService.register(req));
    }

    /**
     * POST /api/auth/login
     * Public — authenticates credentials and returns a JWT.
     */
    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest req) {
        return ResponseEntity.ok(authService.login(req));
    }

    /**
     * GET /api/auth/me
     * Authenticated — returns the current user's profile from the JWT context.
     */
    @GetMapping("/me")
    public ResponseEntity<UserSummary> me(Authentication auth) {
        User user = (User) auth.getPrincipal();
        return ResponseEntity.ok(new UserSummary(
                user.getId().toString(),
                user.getEmail(),
                user.getDisplayName(),
                user.getAvatarUrl(),
                user.getRole().name()));
    }
}
