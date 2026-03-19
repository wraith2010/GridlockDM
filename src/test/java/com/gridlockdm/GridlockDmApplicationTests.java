package com.gridlockdm;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest
@ActiveProfiles("test")
class GridlockDmApplicationTests {

    @Test
    void contextLoads() {
        // Verifies that the Spring application context starts successfully
        // with all beans wired and the H2 schema validated.
    }
}
