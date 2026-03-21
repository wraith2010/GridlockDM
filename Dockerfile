# ── Stage 1: Build ────────────────────────────────────────────────
# Use the official Maven + JDK 21 image — no mvnw wrapper needed.
FROM maven:3.9.6-eclipse-temurin-21-alpine AS builder

WORKDIR /build

# Copy pom.xml first so the Maven dependency layer is cached separately.
# Docker only re-runs this layer when pom.xml changes, not on source edits.
COPY pom.xml .
RUN mvn dependency:go-offline -q

# Copy source and build the fat JAR
COPY src src
RUN mvn clean package -DskipTests -q

# ── Stage 2: Runtime ───────────────────────────────────────────────
# Slim JRE-only image — no build tools in the final container.
FROM eclipse-temurin:21-jre-alpine AS runtime

WORKDIR /app

# Run as a non-root user
RUN addgroup -S gridlock && adduser -S gridlock -G gridlock
USER gridlock

COPY --from=builder /opt/gridlockdm/gridlockdm-*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", \
  "-XX:+UseContainerSupport", \
  "-XX:MaxRAMPercentage=75.0", \
  "-jar", "app.jar"]
