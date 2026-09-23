<?php

return [
    'java_home' => env('BUILD_JAVA_HOME', base_path('.local-tools/jdk/Contents/Home')),
    'sdk' => env('BUILD_ANDROID_SDK', base_path('.local-tools/android-sdk')),
    'gradle' => env('BUILD_GRADLE', base_path('.local-tools/gradle-8.11.1/bin/gradle')),
    'gradle_home' => env('BUILD_GRADLE_HOME', base_path('.local-tools/gradle-home')),
];
