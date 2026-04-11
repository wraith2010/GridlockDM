package com.gridlockdm.domain.session;

import lombok.RequiredArgsConstructor;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.util.Map;

/**
 * Handles game actions sent by clients via WebSocket to /app/session/{code}/action.
 * Each action type is dispatched and re-broadcast to all session subscribers as needed.
 */
@Controller
@RequiredArgsConstructor
public class GameActionController {

    private final SimpMessagingTemplate messaging;

    @MessageMapping("/session/{code}/action")
    public void handleAction(
            @DestinationVariable String code,
            @Payload Map<String, Object> action) {

        String type    = (String) action.get("type");
        Object payload = action.get("payload");

        switch (type != null ? type : "") {
            case "ROTATE_MAP" -> messaging.convertAndSend(
                    "/topic/session/" + code,
                    new SessionService.SessionEvent("MAP_ROTATED", payload));
            default -> { /* unknown action — ignore */ }
        }
    }
}
