package com.piratecinema.app;

import android.app.Activity;
import android.content.Intent;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class TvFocusTest {
    private WebView web;
    private static WebView find(View view){if(view instanceof WebView)return (WebView)view;if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++){WebView result=find(group.getChildAt(i));if(result!=null)return result;}}return null;}
    private String js(String expression)throws Exception{
        CountDownLatch done=new CountDownLatch(1);String[] result={null};
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->web.evaluateJavascript(expression,value->{result[0]=value;done.countDown();}));
        assertTrue("WebView callback timeout",done.await(10,TimeUnit.SECONDS));return result[0];
    }
    private void until(String expression)throws Exception{long end=SystemClock.elapsedRealtime()+10000;while(SystemClock.elapsedRealtime()<end){if("true".equals(js(expression)))return;Thread.sleep(100);}fail("Condition timed out: "+expression);}
    private void key(int code){InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(code);}

    @Test public void dpadFocusDoesNotEditUntilCenter()throws Exception{
        var instrumentation=InstrumentationRegistry.getInstrumentation();var context=instrumentation.getTargetContext();
        Activity activity=instrumentation.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        instrumentation.runOnMainSync(()->web=find(activity.getWindow().getDecorView()));assertNotNull(web);
        js("localStorage.setItem('pirate-cinema-mobile-welcome','done');localStorage.setItem('pirate-cinema-mobile-tv','on');location.reload()");
        until("document.activeElement?.textContent?.trim()==='Главная'");
        key(KeyEvent.KEYCODE_DPAD_DOWN);key(KeyEvent.KEYCODE_DPAD_CENTER);
        until("document.querySelector('nav button[aria-current=page]')?.textContent?.trim()==='Поиск'");
        key(KeyEvent.KEYCODE_DPAD_RIGHT);
        until("document.activeElement?.tagName==='INPUT'");
        assertEquals("true",js("document.activeElement.readOnly"));
        key(KeyEvent.KEYCODE_DPAD_CENTER);
        until("document.activeElement?.dataset.tvEditing==='true'");
        assertEquals("false",js("document.activeElement.readOnly"));
        js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}))");
        until("document.activeElement?.tagName==='BUTTON'");
        assertEquals("true",js("document.querySelector('main input[placeholder]').readOnly"));
        js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}))");
        until("document.activeElement?.getAttribute('aria-current')==='page'");
        assertEquals("\"Поиск\"",js("document.activeElement.textContent.trim()"));
        assertEquals("true",js("(()=>{const input=document.createElement('input');input.readOnly=true;input.style.cssText='position:fixed;left:400px;top:400px;width:100px;height:40px';document.querySelector('main').append(input);input.focus();input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));const stayed=input.readOnly;input.remove();return stayed})()"));
    }
}
