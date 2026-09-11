# Add project specific ProGuard rules here.

-keep class com.omnivault.app.MainActivity { *; }
-keep class com.omnivault.app.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve line numbers and source file names for diagnostics
-keepattributes SourceFile,LineNumberTable