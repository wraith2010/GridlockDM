package com.gridlockdm.domain.character;

import com.gridlockdm.domain.user.User;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

import static org.assertj.core.api.Assertions.*;

class PdfImportServiceTest {

    private final PdfImportService service = new PdfImportService();

    @Test
    void importPdf_nonPdfFile_throwsPdfParseException() {
        var file = new MockMultipartFile(
                "file", "sheet.txt", "text/plain", "not a pdf".getBytes());

        var owner = User.builder().build();

        assertThatThrownBy(() -> service.parseAndMap(file, owner))
                .isInstanceOf(PdfImportService.PdfParseException.class)
                .hasMessageContaining("PDF");
    }

    @Test
    void importPdf_emptyFile_throwsPdfParseException() {
        var file  = new MockMultipartFile("file", "empty.pdf", "application/pdf", new byte[0]);
        var owner = User.builder().build();

        assertThatThrownBy(() -> service.parseAndMap(file, owner))
                .isInstanceOf(PdfImportService.PdfParseException.class);
    }
}
