package dev.hive.codexbridge;

import java.security.MessageDigest;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import javax.net.ssl.X509TrustManager;

/** Validates the daemon's leaf certificate against the fingerprint paired by the user. */
final class HivePinnedCertificateTrustManager implements X509TrustManager {
    private final byte[] expectedFingerprint;

    HivePinnedCertificateTrustManager(byte[] expectedFingerprint) {
        this.expectedFingerprint = expectedFingerprint;
    }

    static byte[] parseFingerprint(String value) {
        if (value == null) throw new IllegalArgumentException("Missing fingerprint");
        String compact = value.replace(":", "").replace(" ", "").trim();
        if (!compact.matches("(?i)[0-9a-f]{64}")) throw new IllegalArgumentException("Invalid SHA-256 fingerprint");
        byte[] result = new byte[32];
        for (int index = 0; index < result.length; index++) {
            result[index] = (byte) Integer.parseInt(compact.substring(index * 2, index * 2 + 2), 16);
        }
        return result;
    }

    @Override
    public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
        throw new CertificateException("Client certificates are not used");
    }

    @Override
    public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
        if (chain == null || chain.length == 0) throw new CertificateException("The daemon sent no certificate");
        X509Certificate certificate = chain[0];
        certificate.checkValidity();
        try {
            byte[] actual = MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded());
            if (!MessageDigest.isEqual(expectedFingerprint, actual)) {
                throw new CertificateException("The daemon certificate fingerprint does not match");
            }
        } catch (CertificateException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new CertificateException("Could not verify the daemon certificate", exception);
        }
    }

    @Override
    public X509Certificate[] getAcceptedIssuers() {
        return new X509Certificate[0];
    }
}
