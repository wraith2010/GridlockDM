package com.gridlockdm.auth;

import com.gridlockdm.auth.AuthDtos.*;
import com.gridlockdm.config.JwtTokenProvider;
import com.gridlockdm.domain.user.User;
import com.gridlockdm.domain.user.UserRepository;
import com.gridlockdm.domain.user.UserRole;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Slf4j
@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository        userRepository;
    private final PasswordEncoder       passwordEncoder;
    private final JwtTokenProvider      jwtTokenProvider;
    private final AuthenticationManager authManager;

    @Value("${gridlock.jwt.expiry-ms}")
    private long expiryMs;

    // ── Register ──────────────────────────────────────────────────────────────

    @Transactional
    public AuthResponse register(RegisterRequest req) {
        if (userRepository.existsByEmail(req.email())) {
            throw new EmailAlreadyUsedException(req.email());
        }

        User user = User.builder()
                .email(req.email().toLowerCase().strip())
                .displayName(req.displayName().strip())
                .passwordHash(passwordEncoder.encode(req.password()))
                .role(UserRole.PLAYER)
                .build();

        user = userRepository.save(user);
        log.info("New user registered: {} ({})", user.getDisplayName(), user.getEmail());

        return buildResponse(user);
    }

    // ── Login ─────────────────────────────────────────────────────────────────

    public AuthResponse login(LoginRequest req) {
        // Throws AuthenticationException (400) on bad credentials
        authManager.authenticate(
                new UsernamePasswordAuthenticationToken(req.email(), req.password()));

        User user = userRepository.findByEmail(req.email())
                .orElseThrow(() -> new IllegalStateException("User disappeared after auth"));

        log.info("User logged in: {}", user.getEmail());
        return buildResponse(user);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private AuthResponse buildResponse(User user) {
        String token = jwtTokenProvider.createUserToken(
                user.getId(),
                user.getEmail(),
                user.getDisplayName(),
                user.getRole().name());

        UserSummary summary = new UserSummary(
                user.getId().toString(),
                user.getEmail(),
                user.getDisplayName(),
                user.getAvatarUrl(),
                user.getRole().name());

        return AuthResponse.of(token, expiryMs, summary);
    }

    // ── Domain exceptions ─────────────────────────────────────────────────────

    public static class EmailAlreadyUsedException extends RuntimeException {
        public EmailAlreadyUsedException(String email) {
            super("Email already registered: " + email);
        }
    }
}
