package com.zaka.screenagent

import java.util.UUID

/** Process-local, single-use click ticket. Preferences and restored intents cannot issue one. */
internal object ProjectionConsentGate {
    private var pending: String? = null

    @Synchronized fun issue(): String = UUID.randomUUID().toString().also { pending = it }

    @Synchronized fun consume(ticket: String?): Boolean {
        if (ticket == null || ticket != pending) return false
        pending = null
        return true
    }

    @Synchronized fun cancel() { pending = null }
}
