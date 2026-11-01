package com.komikta.di

import com.komikta.core.network.ApiConfig
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun provideJson(): Json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

    @Provides
    @Singleton
    fun provideOkHttpClient(): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(ApiConfig.CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        .readTimeout(ApiConfig.SOCKET_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        .writeTimeout(ApiConfig.SOCKET_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        .build()
}
