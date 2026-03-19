pipeline {
    agent any

    tools {
        jdk 'JDK-21'
        maven 'Maven-3.9'
    }

    environment {
        IMAGE_NAME = 'gridlockdm'
        IMAGE_TAG  = "${env.BRANCH_NAME == 'main' ? 'latest' : env.BRANCH_NAME}-${env.BUILD_NUMBER}"
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Build & Test') {
            steps {
                sh 'mvn clean verify -Dspring.profiles.active=test'
            }
            post {
                always {
                    junit '**/target/surefire-reports/*.xml'
                }
            }
        }

        stage('Package') {
            steps {
                sh 'mvn package -DskipTests -q'
                archiveArtifacts artifacts: 'target/gridlockdm-*.jar', fingerprint: true
            }
        }

        stage('Docker Build') {
            steps {
                sh "docker build -t ${IMAGE_NAME}:${IMAGE_TAG} ."
            }
        }

        stage('Docker Push') {
            when {
                branch 'main'
            }
            steps {
                withCredentials([usernamePassword(
                        credentialsId: 'docker-registry-credentials',
                        usernameVariable: 'REGISTRY_USER',
                        passwordVariable: 'REGISTRY_PASS')]) {
                    sh """
                        echo "\$REGISTRY_PASS" | docker login -u "\$REGISTRY_USER" --password-stdin
                        docker push ${IMAGE_NAME}:${IMAGE_TAG}
                        docker tag  ${IMAGE_NAME}:${IMAGE_TAG} ${IMAGE_NAME}:latest
                        docker push ${IMAGE_NAME}:latest
                    """
                }
            }
        }
    }

    post {
        always {
            cleanWs()
        }
        failure {
            echo "Build #${env.BUILD_NUMBER} failed on branch ${env.BRANCH_NAME}"
        }
    }
}
