package com.gridlockdm.common;

import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.util.function.Predicate;

/**
 * Generates human-readable invite codes in the format WORD-NNNN.
 * e.g. WOLF-4271, RUNE-8834, IRON-1192
 *
 * Words are chosen to be unambiguous when spoken aloud at a table.
 */
@Component
public class InviteCodeGenerator {

    private static final String[] WORDS = {
        "WOLF", "RUNE", "IRON", "BLADE", "STORM", "EMBER", "CREST",
        "FROST", "VALE", "GRIM", "THORN", "DUSK", "MIRE", "VALE",
        "OAK", "HORN", "CLAW", "BONE", "SHARD", "PYRE", "MIST",
        "AXLE", "CRYPT", "FANG", "HELM", "BOLT", "CHAIN", "DART",
        "ECHO", "FLARE", "GLOOM", "HAZE", "JADE", "KNELL", "LORE"
    };

    private static final SecureRandom RANDOM = new SecureRandom();

    /**
     * Generates a unique code, checking against the provided uniqueness predicate.
     * Retries up to 20 times before throwing — collision probability is negligible.
     *
     * @param isAlreadyTaken predicate that returns true if the code is already in use
     */
    public String generate(Predicate<String> isAlreadyTaken) {
        for (int attempt = 0; attempt < 20; attempt++) {
            String code = generateOne();
            if (!isAlreadyTaken.test(code)) {
                return code;
            }
        }
        throw new IllegalStateException("Could not generate a unique invite code after 20 attempts");
    }

    private String generateOne() {
        String word   = WORDS[RANDOM.nextInt(WORDS.length)];
        int    digits = 1000 + RANDOM.nextInt(9000);   // 4-digit number, never < 1000
        return word + "-" + digits;
    }
}
