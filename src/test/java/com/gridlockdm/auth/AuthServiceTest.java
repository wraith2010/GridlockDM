package com.gridlockdm.auth;

import com.gridlockdm.auth.AuthDtos.RegisterRequest;
import com.gridlockdm.config.JwtTokenProvider;
import com.gridlockdm.domain.user.User;
import com.gridlockdm.domain.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    @Mock UserRepository        userRepository;
    @Mock PasswordEncoder       passwordEncoder;
    @Mock JwtTokenProvider      jwtTokenProvider;
    @Mock AuthenticationManager authManager;

    @InjectMocks AuthService authService;

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(authService, "expiryMs", 86400000L);
    }

    @Test
    void register_newUser_returnsJwtResponse() {
        var req  = new RegisterRequest("test@example.com", "Tester", "password123");
        var user = User.builder()
                .id(UUID.randomUUID())
                .email("test@example.com")
                .displayName("Tester")
                .passwordHash("hashed")
                .build();

        when(userRepository.existsByEmail(anyString())).thenReturn(false);
        when(passwordEncoder.encode(anyString())).thenReturn("hashed");
        when(userRepository.save(any())).thenReturn(user);
        when(jwtTokenProvider.createUserToken(any(), any(), any(), any())).thenReturn("jwt-token");

        var result = authService.register(req);

        assertThat(result.token()).isEqualTo("jwt-token");
        assertThat(result.user().displayName()).isEqualTo("Tester");
        verify(userRepository).save(any(User.class));
    }

    @Test
    void register_emailTaken_throwsException() {
        when(userRepository.existsByEmail("taken@example.com")).thenReturn(true);
        var req = new RegisterRequest("taken@example.com", "X", "password123");
        assertThatThrownBy(() -> authService.register(req))
                .isInstanceOf(AuthService.EmailAlreadyUsedException.class);
    }

    @Test
    void login_validCredentials_returnsJwtResponse() {
        var user = User.builder()
                .id(UUID.randomUUID())
                .email("user@example.com")
                .displayName("User")
                .passwordHash("hashed")
                .build();

        when(userRepository.findByEmail("user@example.com")).thenReturn(Optional.of(user));
        when(jwtTokenProvider.createUserToken(any(), any(), any(), any())).thenReturn("jwt-token");

        var result = authService.login(new AuthDtos.LoginRequest("user@example.com", "password123"));

        assertThat(result.token()).isEqualTo("jwt-token");
        verify(authManager).authenticate(any());
    }
}
