FROM eclipse-temurin:21-jre-alpine

WORKDIR /app

RUN addgroup -S gridlock && adduser -S gridlock -G gridlock && \
    mkdir -p /app/uploads/maps && \
    chown -R gridlock:gridlock /app

USER gridlock

COPY --chown=gridlock:gridlock gridlockdm.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", \
  "-XX:+UseContainerSupport", \
  "-XX:MaxRAMPercentage=75.0", \
  "-jar", "app.jar"]
