package com.promptgate.video;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * One WebView showing the bundled web app (assets/www). The page is served from a fake https
 * origin so it gets a secure context (MediaRecorder, IndexedDB) without any network access:
 * every request is answered from the APK, anything else is refused.
 */
public class MainActivity extends Activity {
    private static final String TAG = "PGV";
    private static final String HOST = "appassets.androidplatform.net";
    private static final int PICK_FILE = 1;

    private WebView web;
    private ValueCallback<Uri[]> pendingFiles;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); // exports run in real time
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        web.addJavascriptInterface(new Bridge(), "PGVAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("blob".equals(scheme) || "data".equals(scheme)) return null;
                if ("https".equals(scheme) && HOST.equals(uri.getHost())) return asset(uri.getPath());
                return notFound();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (HOST.equals(uri.getHost())) return false;
                if ("https".equals(uri.getScheme())) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (ActivityNotFoundException e) {
                        Log.w(TAG, "no browser for " + uri);
                    }
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                try {
                    startActivityForResult(params.createIntent(), PICK_FILE);
                } catch (ActivityNotFoundException e) {
                    pendingFiles = null;
                    return false;
                }
                return true;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                Log.i(TAG, message.message());
                return true;
            }
        });

        boolean selftest = getIntent() != null && getIntent().getBooleanExtra("selftest", false);
        if (state == null) web.loadUrl("https://" + HOST + "/index.html" + (selftest ? "?selftest=1" : ""));
        else web.restoreState(state);
    }

    private static String mimeOf(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".png")) return "image/png";
        return null;
    }

    private WebResourceResponse asset(String path) {
        if (path == null || path.contains("..")) return notFound();
        String mime = mimeOf(path);
        if (mime == null) return notFound();
        try {
            return new WebResourceResponse(mime, "utf-8", getAssets().open("www" + path));
        } catch (IOException e) {
            return notFound();
        }
    }

    private static WebResourceResponse notFound() {
        WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
        r.setStatusCodeAndReasonPhrase(404, "Not Found");
        return r;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != PICK_FILE || pendingFiles == null) return;
        pendingFiles.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
        pendingFiles = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    /** Called from JavaScript (on a WebView worker thread). Only the bundled page can reach it. */
    private final class Bridge {
        private OutputStream out;
        private Uri outUri;
        private String outShown;

        @JavascriptInterface
        public synchronized boolean beginSave(String name, String mime) {
            abort();
            try {
                String safe = name == null ? "" : name.replaceAll("[^A-Za-z0-9._-]", "_");
                if (safe.isEmpty() || safe.startsWith(".")) safe = "video" + safe;
                boolean video = mime != null && mime.startsWith("video/");
                if (Build.VERSION.SDK_INT >= 29) {
                    String dir = (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_DOWNLOADS) + "/PromptGateVideo";
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, safe);
                    if (video) v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, dir);
                    v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    Uri base = video ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                            : MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                    outUri = getContentResolver().insert(base, v);
                    if (outUri == null) return false;
                    out = getContentResolver().openOutputStream(outUri);
                    outShown = dir + "/" + safe;
                } else {
                    File dir = getExternalFilesDir(video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_DOWNLOADS);
                    if (dir == null) return false;
                    File f = new File(dir, safe);
                    out = new FileOutputStream(f);
                    outShown = f.getAbsolutePath();
                }
                return out != null;
            } catch (Exception e) {
                Log.w(TAG, "beginSave: " + e);
                abort();
                return false;
            }
        }

        @JavascriptInterface
        public synchronized boolean appendSave(String base64) {
            if (out == null) return false;
            try {
                out.write(Base64.decode(base64, Base64.DEFAULT));
                return true;
            } catch (Exception e) {
                Log.w(TAG, "appendSave: " + e);
                abort();
                return false;
            }
        }

        @JavascriptInterface
        public synchronized String endSave() {
            if (out == null) return "";
            try {
                out.close();
                out = null;
                if (outUri != null) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    getContentResolver().update(outUri, v, null, null);
                    outUri = null;
                }
                return outShown;
            } catch (Exception e) {
                Log.w(TAG, "endSave: " + e);
                abort();
                return "";
            }
        }

        private void abort() {
            try {
                if (out != null) out.close();
            } catch (IOException ignored) {
                // nothing left to do with a half-written stream
            }
            out = null;
            if (outUri != null) {
                try {
                    getContentResolver().delete(outUri, null, null);
                } catch (Exception ignored) {
                    // the pending row is hidden from the gallery anyway
                }
                outUri = null;
            }
        }

        @JavascriptInterface
        public void copy(final String text) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("PromptGate Video", text == null ? "" : text));
                }
            });
        }
    }
}
