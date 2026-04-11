package com.gridlockdm.config;

import com.gridlockdm.domain.user.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.web.socket.config.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * STOMP-over-WebSocket configuration.
 *
 * Topic layout:
 *   /topic/session/{code}          — broadcast to all clients in a session
 *   /topic/session/{code}/dm       — DM-only updates (fog reveal preview, etc.)
 *   /topic/session/{code}/observe  — observer feed (same as topic but read-only enforcement)
 *   /user/queue/errors             — per-user error channel
 *
 * Client → server:
 *   /app/session/{code}/action     — player/DM sends a game action
 */
@Slf4j
@Configuration
@EnableWebSocketMessageBroker
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final JwtTokenProvider jwtTokenProvider;
    private final UserRepository    userRepository;

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        // In-memory broker; swap for STOMP-over-RabbitMQ for horizontal scaling
        registry.enableSimpleBroker("/topic", "/queue");
        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns("*")
                .withSockJS();   // SockJS fallback for older browsers / strict firewalls
    }

    /**
     * Intercept CONNECT frames to authenticate the WebSocket session.
     * The JWT is passed as a STOMP header: Authorization: Bearer <token>
     * OR as a query param on the initial HTTP upgrade (handled by JwtAuthFilter).
     */
    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(new ChannelInterceptor() {
            @Override
            public Message<?> preSend(Message<?> message, MessageChannel channel) {
                StompHeaderAccessor accessor =
                        MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);

                if (accessor != null && StompCommand.CONNECT.equals(accessor.getCommand())) {
                    String authHeader = accessor.getFirstNativeHeader("Authorization");
                    if (authHeader != null && authHeader.startsWith("Bearer ")) {
                        String token = authHeader.substring(7);
                        if (jwtTokenProvider.isValid(token)) {
                            String role    = jwtTokenProvider.getRole(token);
                            String subject = jwtTokenProvider.getSubject(token);
                            if ("OBSERVER".equals(role)) {
                                // Observer: no DB lookup needed
                                var auth = new UsernamePasswordAuthenticationToken(
                                        subject, null,
                                        List.of(new SimpleGrantedAuthority("ROLE_OBSERVER")));
                                accessor.setUser(auth);
                            } else {
                                // Regular user: set the User entity as principal so
                                // @AuthenticationPrincipal User user works in @MessageMapping handlers
                                UUID userId = UUID.fromString(subject);
                                userRepository.findById(userId).ifPresent(user -> {
                                    var auth = new UsernamePasswordAuthenticationToken(
                                            user, null, user.getAuthorities());
                                    accessor.setUser(auth);
                                });
                            }
                            log.debug("WebSocket CONNECT authenticated: role={}", role);
                        } else {
                            log.warn("WebSocket CONNECT rejected: invalid token");
                        }
                    }
                }
                return message;
            }
        });
    }
}
