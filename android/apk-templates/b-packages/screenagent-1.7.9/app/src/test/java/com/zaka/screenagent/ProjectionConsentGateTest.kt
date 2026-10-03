package com.zaka.screenagent

/** Runs on the JVM without Android; the production gate has no Android dependencies. */
fun main() {
    ProjectionConsentGate.cancel()
    check(!ProjectionConsentGate.consume(null))
    check(!ProjectionConsentGate.consume("stale-restored-intent"))
    val first = ProjectionConsentGate.issue()
    check(!ProjectionConsentGate.consume("wrong-ticket"))
    check(ProjectionConsentGate.consume(first))
    check(!ProjectionConsentGate.consume(first))
    val canceled = ProjectionConsentGate.issue()
    ProjectionConsentGate.cancel()
    check(!ProjectionConsentGate.consume(canceled))
    val old = ProjectionConsentGate.issue()
    val current = ProjectionConsentGate.issue()
    check(!ProjectionConsentGate.consume(old))
    check(ProjectionConsentGate.consume(current))
    println("PASS: 8 click-ticket assertions (absent, stale, wrong, explicit, replay, cancel, superseded, fresh)")
}
