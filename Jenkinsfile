pipeline {
    agent any

    tools {
        jdk 'JDK-21'
        maven 'Maven-3.9'
    }

    environment {
        DEPLOY_HOST = 'gridlockdm.1031f.com'
        DEPLOY_PATH = '/opt/gridlockdm'
        DEPLOY_USER = 'deploy'
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

        stage('Deploy') {
            when {
                branch 'main'
            }
            steps {
                            sshagent(credentials: ['deploy-ssh-key']) {
                    sh """
                        JAR=\$(ls target/gridlockdm-*.jar | head -1)
                        scp -o StrictHostKeyChecking=no "\$JAR" ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}/gridlockdm.jar
                        ssh -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} 'sudo systemctl restart gridlockdm'
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
