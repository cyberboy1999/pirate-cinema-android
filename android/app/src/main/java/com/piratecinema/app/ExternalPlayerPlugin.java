package com.piratecinema.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.json.JSONObject;

@CapacitorPlugin(name = "ExternalPlayer")
public class ExternalPlayerPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url", "");
        Uri uri = Uri.parse(url);
        if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))) {
            call.reject("Разрешены только HTTP(S)-потоки");
            return;
        }

        if (isLocalTorrent(uri)) {
            new Thread(() -> {
                try {
                    prepareTorrent(uri);
                    getActivity().runOnUiThread(() -> launch(call, uri));
                } catch (Exception error) {
                    call.reject("Не удалось запустить раздачу: " + error.getMessage());
                }
            }, "external-player-prepare").start();
            return;
        }
        launch(call, uri);
    }

    private boolean isLocalTorrent(Uri uri) {
        List<String> parts = uri.getPathSegments();
        return "127.0.0.1".equals(uri.getHost()) && uri.getPort() == 3030 && parts.size() >= 4
            && "torrents".equals(parts.get(0)) && "stream".equals(parts.get(2));
    }

    private void prepareTorrent(Uri uri) throws Exception {
        if (!TorrentService.storageWarning.isEmpty()) throw new IllegalStateException(TorrentService.storageWarning);
        List<String> parts = uri.getPathSegments();
        String base = "http://127.0.0.1:3030/torrents/" + parts.get(1);
        int selection = post(base + "/update_only_files", "{\"only_files\":[" + Integer.parseInt(parts.get(3)) + "]}", "application/json");
        if (selection == 400 && !isLive(base)) throw new IllegalStateException("librqbit rejected file selection");
        int start = post(base + "/start", "", "text/plain");
        if (start == 400 && !isLive(base)) throw new IllegalStateException("librqbit rejected start");
        waitForPeer(base);
    }

    private void waitForPeer(String base) throws Exception {
        long deadline = android.os.SystemClock.elapsedRealtime() + 30_000;
        JSONObject stats = null;
        do {
            stats = json(base + "/stats/v1");
            if (isPlaybackReady(stats)) return;
            Thread.sleep(1_000);
        } while (android.os.SystemClock.elapsedRealtime() < deadline);
        throw new IllegalStateException(playbackWaitError(stats));
    }

    static boolean isPlaybackReady(JSONObject stats) {
        return stats != null && (stats.optBoolean("finished", false) || stats.optLong("progress_bytes", 0) > 0);
    }

    static String playbackWaitError(JSONObject stats) {
        JSONObject live = stats == null ? null : stats.optJSONObject("live");
        JSONObject snapshot = live == null ? null : live.optJSONObject("snapshot");
        JSONObject peers = snapshot == null ? null : snapshot.optJSONObject("peer_stats");
        JSONObject speed = live == null ? null : live.optJSONObject("download_speed");
        int count = peers == null ? 0 : peers.optInt("live", 0);
        String rate = speed == null ? "0.00 MiB/s" : speed.optString("human_readable", "0.00 MiB/s");
        return count == 0
            ? "Нет доступных пиров. Выберите другую раздачу или повторите позже"
            : "Пиры слишком медленные: буфер не получен за 30 с (" + count + ", " + rate + "). Выберите другую раздачу";
    }

    private int post(String target, String body, String contentType) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(target).openConnection();
        try {
            connection.setConnectTimeout(5_000);
            connection.setReadTimeout(10_000);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", contentType);
            connection.setDoOutput(true);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body.getBytes(StandardCharsets.UTF_8));
            }
            int status = connection.getResponseCode();
            if ((status < 200 || status >= 300) && status != 400) throw new IllegalStateException("librqbit HTTP " + status);
            return status;
        } finally {
            connection.disconnect();
        }
    }

    private boolean isLive(String base) throws Exception {
        JSONObject stats = json(base + "/stats/v1");
        return "live".equals(stats.optString("state")) || stats.optBoolean("finished", false);
    }

    private JSONObject json(String target) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(target).openConnection();
        try {
            connection.setConnectTimeout(5_000);
            connection.setReadTimeout(5_000);
            if (connection.getResponseCode() != 200) throw new IllegalStateException("librqbit HTTP " + connection.getResponseCode());
            StringBuilder json = new StringBuilder();
            try (BufferedReader input = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                for (String line; (line = input.readLine()) != null;) json.append(line);
            }
            return new JSONObject(json.toString());
        } finally {
            connection.disconnect();
        }
    }

    private void launch(PluginCall call, Uri uri) {
        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "video/*");
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        intent.putExtra("title", call.getString("title", "Pirate Cinema"));
        Integer position = call.getInt("positionMs", 0);
        if (position != null && position > 0) intent.putExtra("position", position);
        try {
            startActivityForResult(call, Intent.createChooser(intent, "Открыть с помощью"), "playerResult");
        } catch (ActivityNotFoundException | SecurityException error) {
            call.reject("На устройстве нет подходящего видеоплеера");
        }
    }

    @ActivityCallback
    private void playerResult(PluginCall call, ActivityResult activityResult) {
        if (call == null) return;
        Intent data = activityResult.getData();
        JSObject result = new JSObject();
        result.put("ok", activityResult.getResultCode() == Activity.RESULT_OK);
        if (data != null && data.hasExtra("position")) result.put("positionMs", Math.max(0, data.getIntExtra("position", 0)));
        if (data != null && data.hasExtra("duration")) result.put("durationMs", Math.max(0, data.getIntExtra("duration", 0)));
        result.put("completed", activityResult.getResultCode() == Activity.RESULT_OK && (data == null || !data.hasExtra("position")));
        call.resolve(result);
    }
}
