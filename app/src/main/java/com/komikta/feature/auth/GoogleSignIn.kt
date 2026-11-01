package com.komikta.feature.auth

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.PrepareGetCredentialResponse
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import com.komikta.BuildConfig
import com.komikta.core.common.Result
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

object GoogleSignIn {
    private var manager: CredentialManager? = null
    private var pending: PrepareGetCredentialResponse.PendingGetCredentialHandle? = null

    private fun manager(context: Context) = manager ?: CredentialManager.create(context.applicationContext).also { manager = it }

    private fun sheetRequest(clientId: String) = GetCredentialRequest.Builder()
        .addCredentialOption(GetGoogleIdOption.Builder().setServerClientId(clientId).setFilterByAuthorizedAccounts(false).setAutoSelectEnabled(false).build())
        .build()

    private fun fullRequest(clientId: String) = GetCredentialRequest.Builder()
        .addCredentialOption(GetSignInWithGoogleOption.Builder(clientId).build())
        .build()

    suspend fun prepare(context: Context) {
        val clientId = BuildConfig.GOOGLE_WEB_CLIENT_ID
        if (clientId.isBlank() || pending != null) return
        withContext(Dispatchers.Default) {
            try {
                val r = manager(context).prepareGetCredential(sheetRequest(clientId))
                pending = r.pendingGetCredentialHandle
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Unit
            }
        }
    }

    private suspend fun fetch(context: Context, clientId: String): GetCredentialResponse {
        val mgr = manager(context)
        val handle = pending
        pending = null
        if (handle != null) {
            try {
                return mgr.getCredential(context, handle)
            } catch (e: GetCredentialCancellationException) {
                throw e
            } catch (e: GetCredentialException) {
                Unit
            }
        }
        return try {
            mgr.getCredential(context, sheetRequest(clientId))
        } catch (e: NoCredentialException) {
            mgr.getCredential(context, fullRequest(clientId))
        }
    }

    suspend fun idToken(context: Context): Result<String> {
        val clientId = BuildConfig.GOOGLE_WEB_CLIENT_ID
        if (clientId.isBlank()) return Result.Error("Login Google belum dikonfigurasi di aplikasi ini", "NOT_CONFIGURED")
        return try {
            val credential = fetch(context, clientId).credential
            if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                Result.Success(GoogleIdTokenCredential.createFrom(credential.data).idToken)
            } else {
                Result.Error("Jenis kredensial tidak didukung")
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: GetCredentialCancellationException) {
            Result.Error("Login dibatalkan", "CANCELLED")
        } catch (e: GetCredentialException) {
            Result.Error("Login Google gagal: ${e.message ?: "tidak diketahui"}", throwable = e)
        } catch (e: GoogleIdTokenParsingException) {
            Result.Error("Token Google tidak valid", throwable = e)
        } catch (e: Exception) {
            Result.Error(e.message ?: "Login Google gagal", throwable = e)
        }
    }
}

@Composable
fun rememberGoogleSignIn(
    onToken: (String) -> Unit,
    onError: (String) -> Unit,
    onStart: () -> Unit = {},
    onDone: () -> Unit = {}
): () -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val tokenHandler = rememberUpdatedState(onToken)
    val errorHandler = rememberUpdatedState(onError)
    val startHandler = rememberUpdatedState(onStart)
    val doneHandler = rememberUpdatedState(onDone)
    LaunchedEffect(Unit) { GoogleSignIn.prepare(context) }
    val action: () -> Unit = {
        startHandler.value()
        scope.launch {
            when (val r = GoogleSignIn.idToken(context)) {
                is Result.Success -> tokenHandler.value(r.data)
                is Result.Error -> {
                    doneHandler.value()
                    if (r.code != "CANCELLED") errorHandler.value(r.message)
                    GoogleSignIn.prepare(context)
                }
                else -> doneHandler.value()
            }
        }
    }
    return action
}
