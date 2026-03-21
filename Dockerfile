FROM eclipse-temurin:21-jre-alpine

WORKDIR /app

RUN addgroup -S gridlock && adduser -S gridlock -G gridlock
USER gridlock

COPY gridlockdm.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", \
  "-XX:+UseContainerSupport", \
  "-XX:MaxRAMPercentage=75.0", \
  "-jar", "app.jar"]
