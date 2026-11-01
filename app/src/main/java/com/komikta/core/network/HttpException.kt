package com.komikta.core.network

import java.io.IOException

class HttpException(val code: Int) : IOException("HTTP $code")
