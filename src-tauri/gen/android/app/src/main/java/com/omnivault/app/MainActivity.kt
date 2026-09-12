package com.omnivault.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import org.json.JSONObject
import java.io.File
import java.util.UUID

class MainActivity : TauriActivity() {
  private var multicastLock: WifiManager.MulticastLock? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    acquireMulticastLock()
    handleIncomingIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleIncomingIntent(intent)
  }

  override fun onResume() {
    super.onResume()
    acquireMulticastLock()
  }

  override fun onPause() {
    super.onPause()
    releaseMulticastLock()
  }

  override fun onDestroy() {
    super.onDestroy()
    releaseMulticastLock()
  }

  private fun handleIncomingIntent(intent: Intent?) {
    if (intent == null) return
    val action = intent.action ?: return
    val type = intent.type ?: ""

    if (Intent.ACTION_SEND == action) {
      if (type.startsWith("text/")) {
        handleSendText(intent)
      } else if (type.startsWith("image/")) {
        handleSendImage(intent)
      }
    } else if (Intent.ACTION_SEND_MULTIPLE == action && type.startsWith("image/")) {
      handleSendMultipleImages(intent)
    }
  }

  private fun handleSendText(intent: Intent) {
    val text = intent.getStringExtra(Intent.EXTRA_TEXT)
      ?: intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
      ?: ""
    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: ""
    if (text.isBlank() && subject.isBlank()) return

    val shareObj = JSONObject().apply {
      put("id", UUID.randomUUID().toString())
      put("type", "text")
      put("title", if (subject.isNotBlank()) subject else "Shared capture")
      put("content", text)
      put("timestamp", System.currentTimeMillis())
    }

    savePendingShare(shareObj)
  }

  private fun handleSendImage(intent: Intent) {
    val imageUri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
      ?: intent.clipData?.getItemAt(0)?.uri
      ?: return

    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
      ?: intent.getStringExtra(Intent.EXTRA_TEXT)
      ?: "Shared image"

    saveImageUri(imageUri, subject)
  }

  private fun handleSendMultipleImages(intent: Intent) {
    val imageUris = intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
    if (imageUris != null) {
      for (uri in imageUris) {
        saveImageUri(uri, "Shared image")
      }
    }
  }

  private fun saveImageUri(uri: Uri, title: String) {
    try {
      val sharesDir = File(filesDir, "incoming_shares").apply { mkdirs() }
      val id = UUID.randomUUID().toString()
      val binFile = File(sharesDir, "share_$id.bin")

      contentResolver.openInputStream(uri)?.use { input ->
        binFile.outputStream().use { output ->
          input.copyTo(output)
        }
      }

      val mimeType = contentResolver.getType(uri) ?: "image/jpeg"

      val shareObj = JSONObject().apply {
        put("id", id)
        put("type", "image")
        put("title", title)
        put("bin_file", binFile.absolutePath)
        put("mime_type", mimeType)
        put("timestamp", System.currentTimeMillis())
      }

      savePendingShare(shareObj)
    } catch (e: Exception) {
      e.printStackTrace()
    }
  }

  private fun savePendingShare(shareObj: JSONObject) {
    try {
      val sharesDir = File(filesDir, "incoming_shares").apply { mkdirs() }
      val jsonFile = File(sharesDir, "share_${shareObj.getString("id")}.json")
      jsonFile.writeText(shareObj.toString())
    } catch (e: Exception) {
      e.printStackTrace()
    }
  }

  private fun acquireMulticastLock() {
    try {
      if (multicastLock == null) {
        val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        multicastLock = wifi?.createMulticastLock("omnivault_multicast_lock")?.apply {
          setReferenceCounted(true)
        }
      }
      if (multicastLock?.isHeld == false) {
        multicastLock?.acquire()
      }
    } catch (e: Exception) {
      e.printStackTrace()
    }
  }

  private fun releaseMulticastLock() {
    try {
      if (multicastLock?.isHeld == true) {
        multicastLock?.release()
      }
    } catch (e: Exception) {
      e.printStackTrace()
    }
  }
}
