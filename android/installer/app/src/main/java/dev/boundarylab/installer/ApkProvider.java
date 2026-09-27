package dev.boundarylab.installer;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/** Shares exactly one private APK, read-only, through a temporary URI grant. */
public final class ApkProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }
    private File payload(Uri uri) {
        if (!"content".equals(uri.getScheme())
                || !(getContext().getPackageName() + ".apk").equals(uri.getAuthority())
                || !"/safe.apk".equals(uri.getEncodedPath())
                || uri.getQuery() != null || uri.getFragment() != null) {
            throw new IllegalArgumentException("Unknown APK URI");
        }
        return new File(getContext().getFilesDir(), "safe.apk");
    }
    @Override public String getType(Uri uri) {
        payload(uri);
        return "application/vnd.android.package-archive";
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read only");
        return ParcelFileDescriptor.open(payload(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        File file = payload(uri);
        String[] columns = projection == null
                ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
        MatrixCursor cursor = new MatrixCursor(columns);
        Object[] row = new Object[columns.length];
        for (int i = 0; i < columns.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) row[i] = "safe.apk";
            if (OpenableColumns.SIZE.equals(columns[i])) row[i] = file.length();
        }
        cursor.addRow(row);
        return cursor;
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read only"); }
    @Override public int update(Uri uri, ContentValues values, String where, String[] args) { throw new UnsupportedOperationException("Read only"); }
    @Override public int delete(Uri uri, String where, String[] args) { throw new UnsupportedOperationException("Read only"); }
}
