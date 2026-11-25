// 시연·점검용 관리자 빌드. frontend/.env.android.local 에 VITE_ADMIN_MODE=true 를 넣고 빌드한 폰에서만 켠다.
// 켜면 검색·경로 고르기 화면에 지도를 보이고, 길안내를 시작하면 묻지 않고 카메라를 켜 인식 박스를 화면 가득 보인다.
export const ADMIN_MODE = import.meta.env.VITE_ADMIN_MODE === 'true';
