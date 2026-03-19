package com.gridlockdm.config;

import com.gridlockdm.domain.user.UserRepository;
import io.jsonwebtoken.Claims;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.UUID;

/**
 * Reads the Authorization: Bearer <token> header and populates the
 * Spring Security context for every authenticated request.
 *
 * Observer tokens (role=OBSERVER) are also accepted here so the
 * WebSocket upgrade and any REST calls from observers are authenticated.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtTokenProvider  jwtTokenProvider;
    private final UserRepository     userRepository;

    @Override
    protected void doFilterInternal(
            @NonNull HttpServletRequest  request,
            @NonNull HttpServletResponse response,
            @NonNull FilterChain         chain) throws ServletException, IOException {

        String token = extractToken(request);

        if (token != null && jwtTokenProvider.isValid(token)) {
            try {
                authenticate(token, request);
            } catch (Exception ex) {
                log.warn("Could not authenticate token: {}", ex.getMessage());
            }
        }

        chain.doFilter(request, response);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private void authenticate(String token, HttpServletRequest request) {
        Claims claims = jwtTokenProvider.parseToken(token);
        String role   = (String) claims.get("role");

        if ("OBSERVER".equals(role)) {
            // Observer: no DB lookup needed — trust the signed token claims
            var auth = new UsernamePasswordAuthenticationToken(
                    claims.getSubject(),
                    null,
                    List.of(new SimpleGrantedAuthority("ROLE_OBSERVER")));
            auth.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
            SecurityContextHolder.getContext().setAuthentication(auth);

        } else {
            // Regular user: validate the subject maps to a real account
            UUID userId = UUID.fromString(claims.getSubject());
            userRepository.findById(userId).ifPresent(user -> {
                var auth = new UsernamePasswordAuthenticationToken(
                        user, null, user.getAuthorities());
                auth.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
                SecurityContextHolder.getContext().setAuthentication(auth);
            });
        }
    }

    private String extractToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (StringUtils.hasText(header) && header.startsWith("Bearer ")) {
            return header.substring(7);
        }
        // Also accept token as a query param for WebSocket upgrade requests
        // (browsers can't set headers on WS connections)
        String queryToken = request.getParameter("token");
        if (StringUtils.hasText(queryToken)) {
            return queryToken;
        }
        return null;
    }
}
