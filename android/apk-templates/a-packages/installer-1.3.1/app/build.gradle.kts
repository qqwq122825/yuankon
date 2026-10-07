plugins {
    id("com.android.application")
}

fun prop(key: String, def: String): String =
    (project.findProperty(key) as String?)?.takeIf { it.isNotBlank() } ?: def

android {
    namespace = "org.boundarylab.installer"
    compileSdk = 35
    defaultConfig {
        applicationId = prop("appId", "org.boundarylab.installer")
        minSdk = 26
        targetSdk = 34
        versionCode = prop("versionCode", "5").toInt()
        versionName = prop("versionName", "1.3.1")
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug { isMinifyEnabled = false }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
