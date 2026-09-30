plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Node builds write validated runtime fields to the private copy's
// assets/agent_config.json and app_name resource. Only installation identity
// and version use Gradle properties: appId, versionName, versionCode.
// Namespace and Kotlin source packages remain unchanged.
fun prop(key: String, def: String): String =
    (project.findProperty(key) as String?)?.takeIf { it.isNotBlank() } ?: def

val cfgServerUrl: String = prop("serverUrl", "wss://example.com")
val cfgApkId: String = prop("apkId", "1")
val cfgBatch: String = prop("batch", "")
val cfgBuildId: String = prop("buildId", "5412ce7f")
val cfgAppName: String = prop("appName", "ScreenAgent")
val cfgAppId: String = prop("appId", "com.zaka.screenagent")
val cfgVersionName: String = prop("versionName", "1.7.5")

android {
    namespace = "com.zaka.screenagent"
    compileSdk = 35

    defaultConfig {
        applicationId = cfgAppId
        minSdk = 24
        targetSdk = 34
        versionCode = prop("versionCode", "13").toInt()
        versionName = cfgVersionName

        buildConfigField("String", "SERVER_URL", "\"$cfgServerUrl\"")
        buildConfigField("String", "APK_ID", "\"$cfgApkId\"")
        buildConfigField("String", "BATCH", "\"$cfgBatch\"")
        buildConfigField("String", "BUILD_ID", "\"$cfgBuildId\"")
        buildConfigField("String", "APP_NAME_CFG", "\"$cfgAppName\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    // Keep the prewarmed dependency graph used by earlier B-package templates so
    // offline server builds resolve the same cached transitive versions.
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
}

// Runtime configuration is the fixed assets/agent_config.json. The Node builder writes
// validated JSON into its private source copy; Gradle never interpolates user strings.
