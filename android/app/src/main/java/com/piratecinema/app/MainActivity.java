package com.piratecinema.app;

import android.os.Bundle;
import android.os.SystemClock;
import android.app.UiModeManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import androidx.activity.OnBackPressedCallback;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        long splashStarted=SystemClock.uptimeMillis();
        SplashScreen splash=SplashScreen.installSplashScreen(this);
        splash.setKeepOnScreenCondition(()->SystemClock.uptimeMillis()-splashStarted<1200);
        registerPlugin(ExternalPlayerPlugin.class);
        registerPlugin(LibrqbitPlugin.class);
        registerPlugin(TorrentMediaPlugin.class);
        registerPlugin(MobileStoragePlugin.class);
        registerPlugin(PlatformToolsPlugin.class);
        registerPlugin(TorrentSearchPlugin.class);
        registerPlugin(PlayerScreenPlugin.class);
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true) {
            private boolean handling=false;
            @Override public void handleOnBackPressed() {
                if(handling)return;
                handling=true;
                bridge.getWebView().evaluateJavascript("(()=>{if(location.hash==='#player'){history.back();return true}return false})()",value->{
                    if("true".equals(value))bridge.getWebView().postDelayed(()->handling=false,300);
                    else{setEnabled(false);getOnBackPressedDispatcher().onBackPressed();setEnabled(true);handling=false;}
                });
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        UiModeManager uiMode=(UiModeManager)getSystemService(Context.UI_MODE_SERVICE);
        boolean television=uiMode!=null&&uiMode.getCurrentModeType()==Configuration.UI_MODE_TYPE_TELEVISION;
        setRequestedOrientation(television?ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED:ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
    }
}
