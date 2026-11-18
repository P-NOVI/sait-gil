package com.pnovi.saitgil;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.pnovi.saitgil.vision.SaitgilVisionPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 브리지는 super.onCreate 안에서 만들어지므로 플러그인은 그 전에 등록한다.
        registerPlugin(SaitgilVisionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
