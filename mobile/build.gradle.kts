plugins {
    // Kotlin/JVM ONLY — no Android plugin, no com.android.application
    kotlin("jvm") version "2.0.21"
}

group = "com.hackathon.mobile"
version = "1.0.0"

// Force JDK 21 toolchain — this project must NOT use JDK 26
kotlin {
    jvmToolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

repositories {
    mavenCentral()
}

dependencies {
    // JSON deserialization — the @SerializedName contract lives here
    implementation("com.google.code.gson:gson:2.11.0")

    // Test framework
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
}
