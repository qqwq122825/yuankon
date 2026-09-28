package com.zaka.screenagent

import android.app.Application

class AgentApp : Application() {

    override fun onCreate() {
        super.onCreate()
        instance = this
        // 预热配置
        AgentConfig.get(this)
    }

    companion object {
        @Volatile
        lateinit var instance: AgentApp
            private set

    }
}
