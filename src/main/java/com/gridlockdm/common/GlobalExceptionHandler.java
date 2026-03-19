package com.gridlockdm.common;

import com.gridlockdm.auth.AuthService.EmailAlreadyUsedException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.DisabledException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

import java.time.Instant;
import java.util.Map;
import java.util.stream.Collectors;

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    // ── Validation errors (400) ───────────────────────────────────────────────

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(
            MethodArgumentNotValidException ex,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {

        Map<String, String> fieldErrors = ex.getBindingResult()
                .getFieldErrors()
                .stream()
                .collect(Collectors.toMap(
                        FieldError::getField,
                        f -> f.getDefaultMessage() != null ? f.getDefaultMessage() : "invalid",
                        (a, b) -> a));   // keep first error per field

        return ResponseEntity.badRequest().body(
                ErrorResponse.of("VALIDATION_ERROR", "Request validation failed", fieldErrors));
    }

    // ── Auth errors ───────────────────────────────────────────────────────────

    @ExceptionHandler(BadCredentialsException.class)
    public ResponseEntity<ErrorResponse> handleBadCredentials(BadCredentialsException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(ErrorResponse.of("INVALID_CREDENTIALS", "Invalid email or password"));
    }

    @ExceptionHandler(EmailAlreadyUsedException.class)
    public ResponseEntity<ErrorResponse> handleEmailTaken(EmailAlreadyUsedException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ErrorResponse.of("EMAIL_TAKEN", ex.getMessage()));
    }

    // ── Domain / not found errors ─────────────────────────────────────────────

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(ResourceNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ErrorResponse.of("NOT_FOUND", ex.getMessage()));
    }

    @ExceptionHandler(ForbiddenException.class)
    public ResponseEntity<ErrorResponse> handleForbidden(ForbiddenException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ErrorResponse.of("FORBIDDEN", ex.getMessage()));
    }

    @ExceptionHandler(com.gridlockdm.domain.character.PdfImportService.PdfParseException.class)
    public ResponseEntity<ErrorResponse> handlePdfParse(
            com.gridlockdm.domain.character.PdfImportService.PdfParseException ex) {
        return ResponseEntity.badRequest()
                .body(ErrorResponse.of("PDF_PARSE_ERROR", ex.getMessage()));
    }

    @ExceptionHandler(com.gridlockdm.domain.character.DdbImportService.DdbCharacterNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleDdbNotFound(
            com.gridlockdm.domain.character.DdbImportService.DdbCharacterNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ErrorResponse.of("DDB_CHARACTER_NOT_FOUND", ex.getMessage()));
    }

    @ExceptionHandler(com.gridlockdm.domain.character.DdbImportService.DdbImportException.class)
    public ResponseEntity<ErrorResponse> handleDdbImport(
            com.gridlockdm.domain.character.DdbImportService.DdbImportException ex) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(ErrorResponse.of("DDB_IMPORT_ERROR", ex.getMessage()));
    }

    // ── Catch-all (500) ───────────────────────────────────────────────────────

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleAll(Exception ex) {
        log.error("Unhandled exception", ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ErrorResponse.of("INTERNAL_ERROR", "An unexpected error occurred"));
    }

    // ── Response shape ────────────────────────────────────────────────────────

    public record ErrorResponse(
            String              code,
            String              message,
            Map<String, String> details,
            Instant             timestamp
    ) {
        static ErrorResponse of(String code, String message) {
            return new ErrorResponse(code, message, null, Instant.now());
        }

        static ErrorResponse of(String code, String message, Map<String, String> details) {
            return new ErrorResponse(code, message, details, Instant.now());
        }
    }

    // ── Reusable domain exceptions ────────────────────────────────────────────

    public static class ResourceNotFoundException extends RuntimeException {
        public ResourceNotFoundException(String message) { super(message); }
    }

    public static class ForbiddenException extends RuntimeException {
        public ForbiddenException(String message) { super(message); }
    }
}
