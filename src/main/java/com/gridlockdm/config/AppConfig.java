package com.gridlockdm.config;

import io.netty.channel.ChannelOption;
import io.netty.handler.timeout.ReadTimeoutHandler;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import reactor.netty.http.client.HttpClient;

import java.nio.file.Paths;
import java.util.concurrent.TimeUnit;

@Configuration
public class AppConfig {

    /**
     * Shared WebClient builder — injected into DdbImportService and
     * any other services that make outbound HTTP calls.
     */
    @Bean
    public WebClient.Builder webClientBuilder() {
        HttpClient httpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 5000)
                .doOnConnected(conn -> conn.addHandlerLast(new ReadTimeoutHandler(15, TimeUnit.SECONDS)));
        return WebClient.builder()
                .clientConnector(new ReactorClientHttpConnector(httpClient));
    }

    /**
     * Serve uploaded map images from the local filesystem at /uploads/maps/**.
     */
    @Bean
    public WebMvcConfigurer uploadResourceHandler(
            @Value("${gridlock.uploads.map-dir:./uploads/maps}") String mapDir,
            @Value("${gridlock.uploads.map-url-prefix:/uploads/maps}") String mapUrlPrefix) {
        return new WebMvcConfigurer() {
            @Override
            public void addResourceHandlers(ResourceHandlerRegistry registry) {
                String location = "file:" + Paths.get(mapDir).toAbsolutePath() + "/";
                registry.addResourceHandler(mapUrlPrefix + "/**")
                        .addResourceLocations(location);
            }
        };
    }
}
