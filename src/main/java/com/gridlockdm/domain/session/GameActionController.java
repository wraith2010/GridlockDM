package com.gridlockdm.domain.session;

import com.gridlockdm.domain.user.User;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;

import java.util.Map;
import java.util.UUID;

/**
 * Handles game actions sent by clients via WebSocket to /app/session/{code}/action.
 * Each action type is dispatched and re-broadcast to all session subscribers as needed.
 */
@Controller
@RequiredArgsConstructor
public class GameActionController {

    private final SimpMessagingTemplate messaging;
    private final SessionService        sessionService;

    @MessageMapping("/session/{code}/action")
    public void handleAction(
            @DestinationVariable String code,
            @Payload Map<String, Object> action,
            @AuthenticationPrincipal User user) {

        String type    = (String) action.get("type");
        Object payload = action.get("payload");

        switch (type != null ? type : "") {

            case "ROTATE_MAP" -> messaging.convertAndSend(
                    "/topic/session/" + code,
                    new SessionService.SessionEvent("MAP_ROTATED", payload));

            case "MOVE_TOKEN" -> {
                if (payload instanceof Map<?, ?> p) {
                    UUID   tokenId = UUID.fromString((String) p.get("tokenId"));
                    double x       = toDouble(p.get("x"));
                    double y       = toDouble(p.get("y"));
                    sessionService.moveToken(code, user, tokenId, x, y);
                }
            }

            default -> { /* unknown action — ignore */ }
        }
    }

    private static double toDouble(Object v) {
        if (v instanceof Number n) return n.doubleValue();
        return 0.0;
    }
}
