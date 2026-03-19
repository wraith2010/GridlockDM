package com.gridlockdm.common;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.*;

class InviteCodeGeneratorTest {

    private final InviteCodeGenerator generator = new InviteCodeGenerator();

    @Test
    void generate_producesCorrectFormat() {
        String code = generator.generate(c -> false);
        // Format: WORD-NNNN  e.g. WOLF-4271
        assertThat(code).matches("[A-Z]+-\\d{4}");
    }

    @Test
    void generate_avoidsAlreadyTakenCodes() {
        String first  = generator.generate(c -> false);
        String second = generator.generate(first::equals);   // reject first code
        assertThat(second).isNotEqualTo(first);
    }

    @Test
    void generate_throwsAfterMaxRetries() {
        // Reject everything — should exhaust retries
        assertThatThrownBy(() -> generator.generate(c -> true))
                .isInstanceOf(IllegalStateException.class);
    }
}
