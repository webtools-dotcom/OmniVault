package com.omnivault.app

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var multicastLock: WifiManager.MulticastLock? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    acquireMulticastLock()
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
