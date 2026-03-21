pipeline {
        agent any

        tools {
                    jdk 'JDK-21'
                    maven 'Maven-3.9'
        }

        environment {
                    DEPLOY_HOST = 'gridlockdm.1031f.com'
                    DEPLOY_PATH = '/opt/gridlockdm'
                    DEPLOY_USER = 'gridlockdm'
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
                                                        sshagent(credentials: ['ssh-deploy-gridlockdm']) {
                                                                                sh """
                                                                                    JAR=\$(ls target/gridlockdm-*.jar | head -1)

                                                                                    echo ">>> Copying JAR to server..."
                                                                                    scp -o StrictHostKeyChecking=no "\$JAR" ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}/gridlockdm.jar

                                                                                    echo ">>> Copying docker-compose.yml to server..."
                                                                                    scp -o StrictHostKeyChecking=no docker-compose.yml ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}/docker-compose.yml

                                                                                    echo ">>> Stopping containers..."
                                                                                    ssh -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} 'cd ${DEPLOY_PATH} && sudo docker compose down'

                                                                                    echo ">>> Building and starting containers..."
                                                                                    ssh -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} 'cd ${DEPLOY_PATH} && sudo docker compose up -d --build'

                                                                                    echo ">>> Deploy complete."
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
