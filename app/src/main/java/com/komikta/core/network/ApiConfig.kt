package com.komikta.core.network

import com.komikta.BuildConfig

object ApiConfig {
    const val BASE_URL = BuildConfig.BASE_URL
    const val DEFAULT_SOURCE = BuildConfig.DEFAULT_SOURCE

    // Aggressive but stable timeouts for snappy UX
    const val CONNECT_TIMEOUT_MS = 10_000L
    const val REQUEST_TIMEOUT_MS = 20_000L
    const val SOCKET_TIMEOUT_MS = 20_000L

    const val DEFAULT_PAGE_SIZE = 25
}
