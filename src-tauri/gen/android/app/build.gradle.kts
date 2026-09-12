import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "com.omnivault.app"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.omnivault.app"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        create("release") {
            // Signing credentials are read from keystore.properties, which is
            // gitignored. See keystore.properties.example for the required keys.
            // When the file is absent (debug builds, fresh clones, CI without
            // secrets) this block is left unconfigured and the release build is
            // simply unsigned rather than failing.
            val props = Properties().apply {
                val propFile = rootProject.file("keystore.properties")
                if (propFile.exists()) {
                    propFile.inputStream().use { load(it) }
                }
            }
            val storePath = props.getProperty("storeFile")
            if (storePath != null) {
                val ks = file(storePath)
                if (ks.exists()) {
                    storeFile = ks
                    storePassword = props.getProperty("storePassword")
                    keyAlias = props.getProperty("keyAlias")
                    keyPassword = props.getProperty("keyPassword")
                } else {
                    // Say so instead of silently emitting an unsigned APK. A
                    // Unix-style path (/d/keys/...) instead of a Windows one
                    // (D:/keys/...) resolves to nothing here, and the failure
                    // would otherwise only surface as "app not installed" on
                    // the device.
                    logger.warn(
                        "WARNING: keystore.properties sets storeFile=$storePath " +
                        "but no file exists there. The release build will be UNSIGNED. " +
                        "Use an absolute path, e.g. D:/keys/omnivault-release.keystore"
                    )
                }
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")