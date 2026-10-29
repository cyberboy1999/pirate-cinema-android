package com.piratecinema.app;

import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name="PlayerScreen")
public class PlayerScreenPlugin extends Plugin {
    private int previous=ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    private int previousPhysical=ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
    private boolean landscapeForced=false;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final Runnable restoreRequested=()->{if(!landscapeForced)getActivity().setRequestedOrientation(previous);};
    private final Runnable restoreOrientation=()->{
        if(!landscapeForced)return;
        landscapeForced=false;
        getActivity().setRequestedOrientation(previousPhysical);
        handler.postDelayed(restoreRequested,500);
    };

    @PluginMethod
    public void landscape(PluginCall call) {
        getActivity().runOnUiThread(()->{
            handler.removeCallbacks(restoreOrientation);
            handler.removeCallbacks(restoreRequested);
            if (!landscapeForced) {
                previous=getActivity().getRequestedOrientation();
                previousPhysical=getActivity().getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE
                    ? ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                    : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
            }
            landscapeForced=true;
            getActivity().setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            call.resolve(new JSObject());
        });
    }

    @PluginMethod
    public void restore(PluginCall call) {
        getActivity().runOnUiThread(()->{
            handler.removeCallbacks(restoreOrientation);
            handler.postDelayed(restoreOrientation,100);
            call.resolve(new JSObject());
        });
    }

    @Override
    protected void handleOnDestroy() {
        handler.removeCallbacks(restoreOrientation);
        handler.removeCallbacks(restoreRequested);
        landscapeForced=false;
    }
}
