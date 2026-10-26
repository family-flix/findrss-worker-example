import { utils } from "@findrss/util";

export const version = "1.1.0";
export const platform = {
  name: "快手",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" data-n="kuaishou-platform-icon"><path data-n="kuaishou-pixels-ff4300-255" fill="#ff4300" d="M10 21h1v1H10z" />\n    <path data-n="kuaishou-pixels-ff4400-255" fill="#ff4400" d="M17 14h1v1H17z" />\n    <path data-n="kuaishou-pixels-ff4500-255" fill="#ff4500" d="M22 8h1v1H22z" />\n    <path data-n="kuaishou-pixels-ff4501-255" fill="#ff4501" d="M15 19h1v1H15zM8 20h1v1H8z" />\n    <path data-n="kuaishou-pixels-ff4601-255" fill="#ff4601" d="M11 7h1v1H11zM15 8h1v1H15zM15 9h1v1H15zM11 10h1v1H11z" />\n    <path data-n="kuaishou-pixels-ff4602-255" fill="#ff4602" d="M15 2h1v1H15zM18 4h1v1H18zM6 7h1v1H6zM6 8h1v1H6zM20 8h2v1H20zM27 8h1v1H27zM6 9h1v1H6zM6 10h1v1H6zM20 10h1v1H20zM27 11h1v1H27zM7 15h1v1H7zM27 18h1v1H27zM8 22h1v1H8zM27 24h1v1H27zM11 26h1v1H11zM14 28h1v1H14z" />\n    <path data-n="kuaishou-pixels-ff4603-255" fill="#ff4603" d="M23 28h1v1H23z" />\n    <path data-n="kuaishou-pixels-ff4703-255" fill="#ff4703" d="M11 2h1v1H11zM21 3h1v1H21zM24 4h1v1H24zM7 5h1v1H7zM20 9h1v1H20zM27 10h1v1H27zM7 12h1v1H7zM26 13h1v1H26zM6 15h1v1H6zM11 15h1v1H11zM10 16h1v1H10zM4 17h1v1H4zM15 23h1v1H15zM4 25h1v1H4z" />\n    <path data-n="kuaishou-pixels-ff4704-255" fill="#ff4704" d="M10 2h1v1H10zM17 3h1v1H17zM22 3h1v1H22zM27 7h1v1H27zM21 11h1v1H21zM25 14h1v1H25zM8 15h1v1H8zM10 15h1v1H10zM22 19h1v1H22zM27 19h1v1H27zM9 22h1v1H9zM23 23h1v1H23zM16 24h1v1H16zM22 24h1v1H22zM27 25h1v1H27zM10 26h1v1H10zM15 28h1v1H15zM24 28h1v1H24z" />\n    <path data-n="kuaishou-pixels-ff4804-255" fill="#ff4804" d="M20 3h1v1H20zM13 6h1v1H13zM26 6h1v1H26zM27 9h1v1H27zM22 10h1v1H22zM13 11h1v1H13zM9 14h1v1H9zM25 15h1v1H25zM26 16h1v1H26zM4 18h1v1H4zM4 19h1v1H4zM16 19h6v1H16zM4 20h1v1H4zM15 20h1v1H15zM23 20h1v1H23zM27 20h1v1H27zM4 21h1v1H4zM8 21h2v1H8zM15 21h1v1H15zM23 21h1v1H23zM27 21h1v1H27zM4 22h1v1H4zM15 22h1v1H15zM23 22h1v1H23zM27 22h1v1H27zM4 23h1v1H4zM27 23h1v1H27zM4 24h1v1H4zM17 24h5v1H17zM8 27h2v1H8zM12 27h1v1H12zM16 28h7v1H16z" />\n    <path data-n="kuaishou-pixels-ff4805-255" fill="#ff4805" d="M14 2h1v1H14zM16 2h1v1H16zM9 3h1v1H9zM6 6h1v1H6zM14 7h1v1H14zM11 8h1v1H11zM11 9h1v1H11zM14 10h1v1H14zM6 11h1v1H6zM27 12h1v1H27zM11 17h1v1H11zM27 17h1v1H27zM4 26h1v1H4zM26 26h1v1H26zM5 27h1v1H5zM25 27h1v1H25zM13 28h1v1H13z" />\n    <path data-n="kuaishou-pixels-ff4905-255" fill="#ff4905" d="M8 3h1v1H8zM23 3h1v1H23zM22 9h1v1H22zM11 16h1v1H11z" />\n    <path data-n="kuaishou-pixels-ff4906-37" fill="#ff4906" fill-opacity="0.145098" d="M3 31h1v1H3zM28 31h1v1H28z" />\n    <path data-n="kuaishou-pixels-ff4906-38" fill="#ff4906" fill-opacity="0.14902" d="M3 0h1v1H3zM28 0h1v1H28zM0 3h1v1H0zM31 3h1v1H31zM0 28h1v1H0zM31 28h1v1H31z" />\n    <path data-n="kuaishou-pixels-ff4906-77" fill="#ff4906" fill-opacity="0.301961" d="M2 1h1v1H2zM29 1h1v1H29zM2 30h1v1H2zM29 30h1v1H29z" />\n    <path data-n="kuaishou-pixels-ff4906-78" fill="#ff4906" fill-opacity="0.305882" d="M1 2h1v1H1zM30 2h1v1H30zM1 29h1v1H1zM30 29h1v1H30z" />\n    <path data-n="kuaishou-pixels-ff4906-135" fill="#ff4906" fill-opacity="0.529412" d="M31 4h1v1H31zM31 27h1v1H31zM4 31h1v1H4zM27 31h1v1H27z" />\n    <path data-n="kuaishou-pixels-ff4906-136" fill="#ff4906" fill-opacity="0.533333" d="M27 0h1v1H27zM0 27h1v1H0z" />\n    <path data-n="kuaishou-pixels-ff4906-140" fill="#ff4906" fill-opacity="0.54902" d="M4 0h1v1H4zM0 4h1v1H0z" />\n    <path data-n="kuaishou-pixels-ff4906-210" fill="#ff4906" fill-opacity="0.823529" d="M1 3h1v1H1zM30 3h1v1H30zM1 28h1v1H1zM30 28h1v1H30z" />\n    <path data-n="kuaishou-pixels-ff4906-211" fill="#ff4906" fill-opacity="0.827451" d="M3 1h1v1H3zM28 1h1v1H28zM3 30h1v1H3zM28 30h1v1H28z" />\n    <path data-n="kuaishou-pixels-ff4906-213" fill="#ff4906" fill-opacity="0.835294" d="M26 0h1v1H26zM0 5h1v1H0zM31 5h1v1H31zM0 26h1v1H0zM31 26h1v1H31zM5 31h1v1H5zM26 31h1v1H26z" />\n    <path data-n="kuaishou-pixels-ff4906-214" fill="#ff4906" fill-opacity="0.839216" d="M5 0h1v1H5z" />\n    <path data-n="kuaishou-pixels-ff4906-231" fill="#ff4906" fill-opacity="0.905882" d="M2 2h1v1H2zM29 2h1v1H29zM2 29h1v1H2zM29 29h1v1H29z" />\n    <path data-n="kuaishou-pixels-ff4906-251" fill="#ff4906" fill-opacity="0.984314" d="M0 6h1v1H0zM31 6h1v1H31zM0 25h1v1H0zM31 25h1v1H31z" />\n    <path data-n="kuaishou-pixels-ff4906-252" fill="#ff4906" fill-opacity="0.988235" d="M6 0h1v1H6zM25 0h1v1H25zM6 31h1v1H6zM25 31h1v1H25z" />\n    <path data-n="kuaishou-pixels-ff4906-254" fill="#ff4906" fill-opacity="0.996078" d="M4 1h1v1H4zM27 1h1v1H27zM1 4h1v1H1zM30 4h1v1H30zM1 27h1v1H1zM30 27h1v1H30zM4 30h1v1H4zM27 30h1v1H27z" />\n    <path data-n="kuaishou-pixels-ff4906-255" fill="#ff4906" d="M7 0h18v1H7zM5 1h22v1H5zM3 2h7v1H3zM17 2h12v1H17zM2 3h6v1H2zM18 3h2v1H18zM24 3h6v1H24zM2 4h6v1H2zM25 4h5v1H25zM1 5h6v1H1zM26 5h5v1H26zM1 6h5v1H1zM27 6h4v1H27zM0 7h6v1H0zM12 7h2v1H12zM28 7h4v1H28zM0 8h6v1H0zM12 8h3v1H12zM28 8h4v1H28zM0 9h6v1H0zM12 9h3v1H12zM21 9h1v1H21zM28 9h4v1H28zM0 10h6v1H0zM12 10h2v1H12zM21 10h1v1H21zM28 10h4v1H28zM0 11h6v1H0zM28 11h4v1H28zM0 12h7v1H0zM28 12h4v1H28zM0 13h8v1H0zM27 13h5v1H27zM0 14h9v1H0zM26 14h6v1H26zM0 15h6v1H0zM9 15h1v1H9zM26 15h6v1H26zM0 16h5v1H0zM27 16h5v1H27zM0 17h4v1H0zM28 17h4v1H28zM0 18h4v1H0zM28 18h4v1H28zM0 19h4v1H0zM28 19h4v1H28zM0 20h4v1H0zM16 20h7v1H16zM28 20h4v1H28zM0 21h4v1H0zM16 21h7v1H16zM28 21h4v1H28zM0 22h4v1H0zM16 22h7v1H16zM28 22h4v1H28zM0 23h4v1H0zM16 23h7v1H16zM28 23h4v1H28zM0 24h4v1H0zM28 24h4v1H28zM1 25h3v1H1zM28 25h3v1H28zM1 26h3v1H1zM27 26h4v1H27zM2 27h3v1H2zM6 27h1v1H6zM10 27h2v1H10zM26 27h4v1H26zM2 28h11v1H2zM25 28h5v1H25zM3 29h26v1H3zM5 30h22v1H5zM7 31h18v1H7z" />\n    <path data-n="kuaishou-pixels-ff4907-1" fill="#ff4907" fill-opacity="0.003922" d="M30 1h1v1H30zM30 30h1v1H30z" />\n    <path data-n="kuaishou-pixels-ff4908-1" fill="#ff4908" fill-opacity="0.003922" d="M1 1h1v1H1zM1 30h1v1H1z" />\n    <path data-n="kuaishou-pixels-ff4a07-255" fill="#ff4a07" d="M12 6h1v1H12zM12 11h1v1H12zM9 16h1v1H9z" />\n    <path data-n="kuaishou-pixels-ff4a08-255" fill="#ff4a08" d="M25 5h1v1H25z" />\n    <path data-n="kuaishou-pixels-ff4b08-255" fill="#ff4b08" d="M23 19h1v1H23z" />\n    <path data-n="kuaishou-pixels-ff4b09-255" fill="#ff4b09" d="M12 2h1v1H12zM8 4h1v1H8zM19 4h1v1H19zM15 7h1v1H15zM15 10h1v1H15zM8 13h1v1H8zM12 15h1v1H12zM24 15h1v1H24zM5 16h1v1H5zM12 16h1v1H12z" />\n    <path data-n="kuaishou-pixels-ff4b0a-255" fill="#ff4b0a" d="M18 14h1v1H18z" />\n    <path data-n="kuaishou-pixels-ff4c0a-255" fill="#ff4c0a" d="M15 24h1v1H15z" />\n    <path data-n="kuaishou-pixels-ff4d0b-255" fill="#ff4d0b" d="M22 11h1v1H22z" />\n    <path data-n="kuaishou-pixels-ff4d0c-255" fill="#ff4d0c" d="M13 15h1v1H13z" />\n    <path data-n="kuaishou-pixels-ff4e0d-255" fill="#ff4e0d" d="M7 27h1v1H7z" />\n    <path data-n="kuaishou-pixels-ff4e0e-255" fill="#ff4e0e" d="M13 2h1v1H13z" />\n    <path data-n="kuaishou-pixels-ff4f0e-255" fill="#ff4f0e" d="M23 9h1v1H23z" />\n    <path data-n="kuaishou-pixels-ff4f0f-255" fill="#ff4f0f" d="M23 4h1v1H23z" />\n    <path data-n="kuaishou-pixels-ff5110-255" fill="#ff5110" d="M14 6h1v1H14zM14 11h1v1H14z" />\n    <path data-n="kuaishou-pixels-ff5111-255" fill="#ff5111" d="M16 14h1v1H16z" />\n    <path data-n="kuaishou-pixels-ff5313-255" fill="#ff5313" d="M23 10h1v1H23z" />\n    <path data-n="kuaishou-pixels-ff5314-255" fill="#ff5314" d="M16 3h1v1H16zM13 27h1v1H13z" />\n    <path data-n="kuaishou-pixels-ff5416-255" fill="#ff5416" d="M26 12h1v1H26z" />\n    <path data-n="kuaishou-pixels-ff5516-255" fill="#ff5516" d="M10 8h1v1H10zM26 17h1v1H26z" />\n    <path data-n="kuaishou-pixels-ff5517-255" fill="#ff5517" d="M10 9h1v1H10z" />\n    <path data-n="kuaishou-pixels-ff5617-255" fill="#ff5617" d="M24 14h1v1H24z" />\n    <path data-n="kuaishou-pixels-ff5618-255" fill="#ff5618" d="M20 11h1v1H20z" />\n    <path data-n="kuaishou-pixels-ff571a-255" fill="#ff571a" d="M7 11h1v1H7z" />\n    <path data-n="kuaishou-pixels-ff581a-255" fill="#ff581a" d="M5 26h1v1H5z" />\n    <path data-n="kuaishou-pixels-ff591b-255" fill="#ff591b" d="M7 6h1v1H7z" />\n    <path data-n="kuaishou-pixels-ff591c-255" fill="#ff591c" d="M9 20h1v1H9z" />\n    <path data-n="kuaishou-pixels-ff5a1d-255" fill="#ff5a1d" d="M14 15h1v1H14z" />\n    <path data-n="kuaishou-pixels-ff5b1e-255" fill="#ff5b1e" d="M12 26h1v1H12z" />\n    <path data-n="kuaishou-pixels-ff5c1f-255" fill="#ff5c1f" d="M20 4h1v1H20z" />\n    <path data-n="kuaishou-pixels-ff5c20-255" fill="#ff5c20" d="M25 16h1v1H25z" />\n    <path data-n="kuaishou-pixels-ff5e23-255" fill="#ff5e23" d="M16 18h1v1H16zM14 20h1v1H14zM10 22h1v1H10zM14 22h1v1H14zM8 23h1v1H8zM9 26h1v1H9z" />\n    <path data-n="kuaishou-pixels-ff5f23-255" fill="#ff5f23" d="M21 18h1v1H21z" />\n    <path data-n="kuaishou-pixels-ff5f24-255" fill="#ff5f24" d="M17 18h4v1H17zM22 18h1v1H22zM14 21h1v1H14zM11 25h1v1H11z" />\n    <path data-n="kuaishou-pixels-ff6127-255" fill="#ff6127" d="M17 4h1v1H17z" />\n    <path data-n="kuaishou-pixels-ff6228-255" fill="#ff6228" d="M22 4h1v1H22zM14 23h1v1H14z" />\n    <path data-n="kuaishou-pixels-ff632a-255" fill="#ff632a" d="M19 9h1v1H19z" />\n    <path data-n="kuaishou-pixels-ff642b-255" fill="#ff642b" d="M26 7h1v1H26zM23 15h1v1H23z" />\n    <path data-n="kuaishou-pixels-ff662e-255" fill="#ff662e" d="M10 14h1v1H10zM26 25h1v1H26zM24 27h1v1H24z" />\n    <path data-n="kuaishou-pixels-ff672e-255" fill="#ff672e" d="M10 3h1v1H10z" />\n    <path data-n="kuaishou-pixels-ff6830-255" fill="#ff6830" d="M25 13h1v1H25zM10 17h1v1H10z" />\n    <path data-n="kuaishou-pixels-ff6932-255" fill="#ff6932" d="M8 16h1v1H8z" />\n    <path data-n="kuaishou-pixels-ff6b34-255" fill="#ff6b34" d="M17 13h1v1H17zM15 18h1v1H15zM23 24h1v1H23z" />\n    <path data-n="kuaishou-pixels-ff6b35-255" fill="#ff6b35" d="M21 4h1v1H21z" />\n    <path data-n="kuaishou-pixels-ff6d37-255" fill="#ff6d37" d="M14 19h1v1H14z" />\n    <path data-n="kuaishou-pixels-ff6e39-255" fill="#ff6e39" d="M19 10h1v1H19z" />\n    <path data-n="kuaishou-pixels-ff703b-255" fill="#ff703b" d="M11 6h1v1H11zM11 11h1v1H11z" />\n    <path data-n="kuaishou-pixels-ff713d-255" fill="#ff713d" d="M23 8h1v1H23zM15 15h1v1H15z" />\n    <path data-n="kuaishou-pixels-ff723e-255" fill="#ff723e" d="M6 16h1v1H6z" />\n    <path data-n="kuaishou-pixels-ff733f-255" fill="#ff733f" d="M18 5h1v1H18z" />\n    <path data-n="kuaishou-pixels-ff7340-255" fill="#ff7340" d="M19 15h1v1H19z" />\n    <path data-n="kuaishou-pixels-ff7543-255" fill="#ff7543" d="M16 15h1v1H16zM20 15h1v1H20z" />\n    <path data-n="kuaishou-pixels-ff7643-255" fill="#ff7643" d="M18 15h1v1H18z" />\n    <path data-n="kuaishou-pixels-ff7644-255" fill="#ff7644" d="M17 15h1v1H17z" />\n    <path data-n="kuaishou-pixels-ff7745-255" fill="#ff7745" d="M21 7h1v1H21z" />\n    <path data-n="kuaishou-pixels-ff7846-255" fill="#ff7846" d="M22 15h1v1H22z" />\n    <path data-n="kuaishou-pixels-ff7a49-255" fill="#ff7a49" d="M24 5h1v1H24zM19 14h1v1H19z" />\n    <path data-n="kuaishou-pixels-ff7b4b-255" fill="#ff7b4b" d="M10 7h1v1H10zM10 10h1v1H10zM21 15h1v1H21z" />\n    <path data-n="kuaishou-pixels-ff7d4d-255" fill="#ff7d4d" d="M11 21h1v1H11z" />\n    <path data-n="kuaishou-pixels-ff8051-255" fill="#ff8051" d="M7 7h1v1H7zM7 10h1v1H7zM25 26h1v1H25z" />\n    <path data-n="kuaishou-pixels-ff8253-255" fill="#ff8253" d="M26 11h1v1H26z" />\n    <path data-n="kuaishou-pixels-ff8254-255" fill="#ff8254" d="M8 12h1v1H8z" />\n    <path data-n="kuaishou-pixels-ff8255-255" fill="#ff8255" d="M15 14h1v1H15z" />\n    <path data-n="kuaishou-pixels-ff8457-255" fill="#ff8457" d="M8 5h1v1H8z" />\n    <path data-n="kuaishou-pixels-ff8559-255" fill="#ff8559" d="M5 17h1v1H5z" />\n    <path data-n="kuaishou-pixels-ff8659-255" fill="#ff8659" d="M15 3h1v1H15zM26 18h1v1H26z" />\n    <path data-n="kuaishou-pixels-ff875a-255" fill="#ff875a" d="M14 27h1v1H14z" />\n    <path data-n="kuaishou-pixels-ff8a5f-255" fill="#ff8a5f" d="M25 6h1v1H25z" />\n    <path data-n="kuaishou-pixels-ff8b60-255" fill="#ff8b60" d="M16 8h1v1H16zM16 9h1v1H16z" />\n    <path data-n="kuaishou-pixels-ff8c61-255" fill="#ff8c61" d="M22 7h1v1H22zM9 13h1v1H9z" />\n    <path data-n="kuaishou-pixels-ff8c62-255" fill="#ff8c62" d="M12 17h1v1H12z" />\n    <path data-n="kuaishou-pixels-ff8f65-255" fill="#ff8f65" d="M23 14h1v1H23z" />\n    <path data-n="kuaishou-pixels-ff9067-255" fill="#ff9067" d="M9 4h1v1H9zM7 16h1v1H7zM13 16h1v1H13z" />\n    <path data-n="kuaishou-pixels-ff9169-255" fill="#ff9169" d="M10 20h1v1H10z" />\n    <path data-n="kuaishou-pixels-ff926a-255" fill="#ff926a" d="M26 8h1v1H26zM23 18h1v1H23z" />\n    <path data-n="kuaishou-pixels-ff946c-255" fill="#ff946c" d="M7 8h1v1H7zM7 9h1v1H7z" />\n    <path data-n="kuaishou-pixels-ff956e-255" fill="#ff956e" d="M8 19h1v1H8z" />\n    <path data-n="kuaishou-pixels-ff966f-255" fill="#ff966f" d="M19 8h1v1H19z" />\n    <path data-n="kuaishou-pixels-ff9872-255" fill="#ff9872" d="M26 24h1v1H26z" />\n    <path data-n="kuaishou-pixels-ff9a74-255" fill="#ff9a74" d="M15 6h1v1H15zM15 11h1v1H15zM23 11h1v1H23z" />\n    <path data-n="kuaishou-pixels-ff9c77-255" fill="#ff9c77" d="M23 27h1v1H23z" />\n    <path data-n="kuaishou-pixels-ff9d78-255" fill="#ff9d78" d="M10 25h1v1H10z" />\n    <path data-n="kuaishou-pixels-ff9d79-255" fill="#ff9d79" d="M11 14h1v1H11zM8 26h1v1H8z" />\n    <path data-n="kuaishou-pixels-ff9e7a-255" fill="#ff9e7a" d="M5 25h1v1H5z" />\n    <path data-n="kuaishou-pixels-ff9e7b-255" fill="#ff9e7b" d="M11 3h1v1H11zM14 24h1v1H14z" />\n    <path data-n="kuaishou-pixels-ff9f7b-255" fill="#ff9f7b" d="M9 23h1v1H9z" />\n    <path data-n="kuaishou-pixels-ffa27f-255" fill="#ffa27f" d="M20 7h1v1H20z" />\n    <path data-n="kuaishou-pixels-ffa989-255" fill="#ffa989" d="M26 10h1v1H26zM6 26h1v1H6z" />\n    <path data-n="kuaishou-pixels-ffac8e-255" fill="#ffac8e" d="M26 19h1v1H26z" />\n    <path data-n="kuaishou-pixels-ffad8e-255" fill="#ffad8e" d="M12 25h1v1H12z" />\n    <path data-n="kuaishou-pixels-ffad8f-255" fill="#ffad8f" d="M18 13h1v1H18z" />\n    <path data-n="kuaishou-pixels-ffae90-255" fill="#ffae90" d="M20 14h1v1H20zM15 27h1v1H15z" />\n    <path data-n="kuaishou-pixels-ffaf91-255" fill="#ffaf91" d="M9 17h1v1H9z" />\n    <path data-n="kuaishou-pixels-ffb195-255" fill="#ffb195" d="M26 9h1v1H26z" />\n    <path data-n="kuaishou-pixels-ffb296-255" fill="#ffb296" d="M14 14h1v1H14zM11 22h1v1H11z" />\n    <path data-n="kuaishou-pixels-ffb397-255" fill="#ffb397" d="M5 18h1v1H5zM11 18h1v1H11zM7 20h1v1H7zM26 23h1v1H26z" />\n    <path data-n="kuaishou-pixels-ffb398-255" fill="#ffb398" d="M24 20h1v1H24zM16 25h1v1H16z" />\n    <path data-n="kuaishou-pixels-ffb498-255" fill="#ffb498" d="M7 22h1v1H7zM24 22h1v1H24zM21 25h1v1H21zM22 27h1v1H22z" />\n    <path data-n="kuaishou-pixels-ffb499-255" fill="#ffb499" d="M13 5h1v1H13zM13 12h1v1H13zM21 12h1v1H21zM5 19h1v1H5zM5 20h1v1H5zM26 20h1v1H26zM5 21h1v1H5zM7 21h1v1H7zM24 21h1v1H24zM26 21h1v1H26zM5 22h1v1H5zM26 22h1v1H26zM5 23h1v1H5zM5 24h1v1H5zM17 25h4v1H17zM17 27h5v1H17z" />\n    <path data-n="kuaishou-pixels-ffb599-255" fill="#ffb599" d="M14 3h1v1H14zM16 27h1v1H16z" />\n    <path data-n="kuaishou-pixels-ffb59a-255" fill="#ffb59a" d="M19 5h1v1H19z" />\n    <path data-n="kuaishou-pixels-ffb79c-255" fill="#ffb79c" d="M24 16h1v1H24z" />\n    <path data-n="kuaishou-pixels-ffb79d-255" fill="#ffb79d" d="M24 23h1v1H24zM22 25h1v1H22z" />\n    <path data-n="kuaishou-pixels-ffb89e-255" fill="#ffb89e" d="M19 11h1v1H19z" />\n    <path data-n="kuaishou-pixels-ffb99f-255" fill="#ffb99f" d="M7 23h1v1H7z" />\n    <path data-n="kuaishou-pixels-ffbca3-255" fill="#ffbca3" d="M16 7h1v1H16zM16 10h1v1H16zM22 14h1v1H22z" />\n    <path data-n="kuaishou-pixels-ffbfa7-255" fill="#ffbfa7" d="M12 5h1v1H12zM12 12h1v1H12z" />\n    <path data-n="kuaishou-pixels-ffc3ad-255" fill="#ffc3ad" d="M12 3h1v1H12zM12 14h1v1H12zM24 19h1v1H24zM13 26h1v1H13z" />\n    <path data-n="kuaishou-pixels-ffc4ae-255" fill="#ffc4ae" d="M15 25h1v1H15z" />\n    <path data-n="kuaishou-pixels-ffc4af-255" fill="#ffc4af" d="M16 13h1v1H16z" />\n    <path data-n="kuaishou-pixels-ffc5af-255" fill="#ffc5af" d="M25 17h1v1H25z" />\n    <path data-n="kuaishou-pixels-ffc5b0-255" fill="#ffc5b0" d="M14 18h1v1H14z" />\n    <path data-n="kuaishou-pixels-ffc6b1-255" fill="#ffc6b1" d="M16 4h1v1H16z" />\n    <path data-n="kuaishou-pixels-ffc7b3-255" fill="#ffc7b3" d="M22 12h1v1H22z" />\n    <path data-n="kuaishou-pixels-ffc9b5-255" fill="#ffc9b5" d="M23 5h1v1H23z" />\n    <path data-n="kuaishou-pixels-ffc9b6-255" fill="#ffc9b6" d="M17 5h1v1H17z" />\n    <path data-n="kuaishou-pixels-ffcab7-255" fill="#ffcab7" d="M25 12h1v1H25z" />\n    <path data-n="kuaishou-pixels-ffccba-255" fill="#ffccba" d="M21 14h1v1H21z" />\n    <path data-n="kuaishou-pixels-ffcdbb-255" fill="#ffcdbb" d="M7 19h1v1H7z" />\n    <path data-n="kuaishou-pixels-ffcfbd-255" fill="#ffcfbd" d="M13 3h1v1H13zM24 13h1v1H24zM13 14h1v1H13zM7 26h1v1H7z" />\n    <path data-n="kuaishou-pixels-ffd0bf-255" fill="#ffd0bf" d="M14 5h1v1H14zM14 12h1v1H14z" />\n    <path data-n="kuaishou-pixels-ffd3c3-255" fill="#ffd3c3" d="M24 9h1v1H24z" />\n    <path data-n="kuaishou-pixels-ffd6c7-255" fill="#ffd6c7" d="M20 12h1v1H20z" />\n    <path data-n="kuaishou-pixels-ffd7c8-255" fill="#ffd7c8" d="M8 11h1v1H8z" />\n    <path data-n="kuaishou-pixels-ffd8ca-255" fill="#ffd8ca" d="M24 10h1v1H24z" />\n    <path data-n="kuaishou-pixels-ffd9cb-255" fill="#ffd9cb" d="M8 6h1v1H8z" />\n    <path data-n="kuaishou-pixels-ffdacd-255" fill="#ffdacd" d="M9 19h1v1H9z" />\n    <path data-n="kuaishou-pixels-ffdcce-255" fill="#ffdcce" d="M9 8h1v1H9z" />\n    <path data-n="kuaishou-pixels-ffdccf-255" fill="#ffdccf" d="M10 6h1v1H10zM9 9h1v1H9z" />\n    <path data-n="kuaishou-pixels-ffdcd0-255" fill="#ffdcd0" d="M10 11h1v1H10z" />\n    <path data-n="kuaishou-pixels-ffddd0-255" fill="#ffddd0" d="M23 7h1v1H23z" />\n    <path data-n="kuaishou-pixels-ffdfd3-255" fill="#ffdfd3" d="M11 20h1v1H11z" />\n    <path data-n="kuaishou-pixels-ffdfd4-255" fill="#ffdfd4" d="M14 16h1v1H14z" />\n    <path data-n="kuaishou-pixels-ffe1d6-255" fill="#ffe1d6" d="M12 18h1v1H12z" />\n    <path data-n="kuaishou-pixels-ffe1d7-255" fill="#ffe1d7" d="M9 25h1v1H9z" />\n    <path data-n="kuaishou-pixels-ffe2d7-255" fill="#ffe2d7" d="M10 23h1v1H10z" />\n    <path data-n="kuaishou-pixels-ffe3d8-255" fill="#ffe3d8" d="M23 25h1v1H23z" />\n    <path data-n="kuaishou-pixels-ffe3d9-255" fill="#ffe3d9" d="M24 24h1v1H24z" />\n    <path data-n="kuaishou-pixels-ffe5db-255" fill="#ffe5db" d="M25 7h1v1H25zM8 24h1v1H8z" />\n    <path data-n="kuaishou-pixels-ffe5dc-255" fill="#ffe5dc" d="M20 5h1v1H20zM25 25h1v1H25z" />\n    <path data-n="kuaishou-pixels-ffe6dc-255" fill="#ffe6dc" d="M11 24h1v1H11z" />\n    <path data-n="kuaishou-pixels-ffe7de-255" fill="#ffe7de" d="M10 13h1v1H10zM24 26h1v1H24z" />\n    <path data-n="kuaishou-pixels-ffe8e0-255" fill="#ffe8e0" d="M10 4h1v1H10z" />\n    <path data-n="kuaishou-pixels-ffe9e1-255" fill="#ffe9e1" d="M13 20h1v1H13zM13 22h1v1H13z" />\n    <path data-n="kuaishou-pixels-ffe9e2-255" fill="#ffe9e2" d="M16 17h1v1H16z" />\n    <path data-n="kuaishou-pixels-ffeae2-255" fill="#ffeae2" d="M17 17h5v1H17zM13 21h1v1H13z" />\n    <path data-n="kuaishou-pixels-ffeae3-255" fill="#ffeae3" d="M10 18h1v1H10z" />\n    <path data-n="kuaishou-pixels-ffebe3-255" fill="#ffebe3" d="M22 17h1v1H22z" />\n    <path data-n="kuaishou-pixels-ffebe4-255" fill="#ffebe4" d="M11 5h1v1H11zM11 12h1v1H11z" />\n    <path data-n="kuaishou-pixels-ffece5-255" fill="#ffece5" d="M22 5h1v1H22zM17 12h1v1H17zM8 17h1v1H8zM13 23h1v1H13z" />\n    <path data-n="kuaishou-pixels-ffede6-255" fill="#ffede6" d="M18 9h1v1H18z" />\n    <path data-n="kuaishou-pixels-ffede7-255" fill="#ffede7" d="M24 8h1v1H24z" />\n    <path data-n="kuaishou-pixels-ffeee7-255" fill="#ffeee7" d="M19 7h1v1H19z" />\n    <path data-n="kuaishou-pixels-ffeee8-255" fill="#ffeee8" d="M23 16h1v1H23z" />\n    <path data-n="kuaishou-pixels-fff0ea-255" fill="#fff0ea" d="M7 24h1v1H7z" />\n    <path data-n="kuaishou-pixels-fff0eb-255" fill="#fff0eb" d="M15 17h1v1H15z" />\n    <path data-n="kuaishou-pixels-fff1eb-255" fill="#fff1eb" d="M18 6h1v1H18z" />\n    <path data-n="kuaishou-pixels-fff1ec-255" fill="#fff1ec" d="M6 17h1v1H6z" />\n    <path data-n="kuaishou-pixels-fff2ed-255" fill="#fff2ed" d="M24 6h1v1H24zM13 19h1v1H13z" />\n    <path data-n="kuaishou-pixels-fff2ee-255" fill="#fff2ee" d="M21 5h1v1H21z" />\n    <path data-n="kuaishou-pixels-fff3ef-255" fill="#fff3ef" d="M18 10h1v1H18zM24 18h1v1H24zM12 24h1v1H12z" />\n    <path data-n="kuaishou-pixels-fff4f0-255" fill="#fff4f0" d="M9 5h1v1H9zM9 12h1v1H9z" />\n    <path data-n="kuaishou-pixels-fff6f2-255" fill="#fff6f2" d="M9 7h1v1H9zM9 10h1v1H9z" />\n    <path data-n="kuaishou-pixels-fff6f3-255" fill="#fff6f3" d="M23 12h1v1H23zM13 17h1v1H13zM14 25h1v1H14z" />\n    <path data-n="kuaishou-pixels-fff7f4-255" fill="#fff7f4" d="M16 6h1v1H16zM16 11h1v1H16z" />\n    <path data-n="kuaishou-pixels-fff8f5-255" fill="#fff8f5" d="M19 13h1v1H19z" />\n    <path data-n="kuaishou-pixels-fff8f6-255" fill="#fff8f6" d="M15 5h1v1H15zM15 12h1v1H15z" />\n    <path data-n="kuaishou-pixels-fff9f6-255" fill="#fff9f6" d="M15 16h1v1H15z" />\n    <path data-n="kuaishou-pixels-fff9f7-255" fill="#fff9f7" d="M24 11h1v1H24z" />\n    <path data-n="kuaishou-pixels-fffaf8-255" fill="#fffaf8" d="M21 6h1v1H21zM17 16h6v1H17zM23 17h1v1H23z" />\n    <path data-n="kuaishou-pixels-fffaf9-255" fill="#fffaf9" d="M18 12h1v1H18zM16 16h1v1H16z" />\n    <path data-n="kuaishou-pixels-fffbf9-255" fill="#fffbf9" d="M8 7h1v1H8zM8 10h1v1H8zM25 11h1v1H25z" />\n    <path data-n="kuaishou-pixels-fffbfa-255" fill="#fffbfa" d="M15 4h1v1H15zM15 13h1v1H15zM12 21h1v1H12z" />\n    <path data-n="kuaishou-pixels-fffcfa-255" fill="#fffcfa" d="M14 26h1v1H14z" />\n    <path data-n="kuaishou-pixels-fffcfb-255" fill="#fffcfb" d="M25 18h1v1H25zM10 19h1v1H10z" />\n    <path data-n="kuaishou-pixels-fffcfc-255" fill="#fffcfc" d="M19 12h1v1H19z" />\n    <path data-n="kuaishou-pixels-fffdfc-255" fill="#fffdfc" d="M17 6h1v1H17zM22 6h1v1H22zM23 13h1v1H23z" />\n    <path data-n="kuaishou-pixels-fffdfd-255" fill="#fffdfd" d="M18 8h1v1H18zM9 24h2v1H9zM13 24h1v1H13z" />\n    <path data-n="kuaishou-pixels-fffefd-255" fill="#fffefd" d="M8 18h1v1H8zM8 25h1v1H8z" />\n    <path data-n="kuaishou-pixels-fffefe-255" fill="#fffefe" d="M19 6h2v1H19zM17 8h1v1H17zM16 12h1v1H16zM7 18h1v1H7zM11 23h1v1H11z" />\n    <path data-n="kuaishou-pixels-ffffff-255" fill="#ffffff" d="M11 4h4v1H11zM10 5h1v1H10zM16 5h1v1H16zM9 6h1v1H9zM23 6h1v1H23zM17 7h2v1H17zM24 7h1v1H24zM8 8h1v1H8zM25 8h1v1H25zM8 9h1v1H8zM17 9h1v1H17zM25 9h1v1H25zM17 10h1v1H17zM25 10h1v1H25zM9 11h1v1H9zM17 11h2v1H17zM10 12h1v1H10zM24 12h1v1H24zM11 13h4v1H11zM20 13h3v1H20zM7 17h1v1H7zM14 17h1v1H14zM24 17h1v1H24zM6 18h1v1H6zM9 18h1v1H9zM13 18h1v1H13zM6 19h1v1H6zM11 19h2v1H11zM25 19h1v1H25zM6 20h1v1H6zM12 20h1v1H12zM25 20h1v1H25zM6 21h1v1H6zM25 21h1v1H25zM6 22h1v1H6zM12 22h1v1H12zM25 22h1v1H25zM6 23h1v1H6zM12 23h1v1H12zM25 23h1v1H25zM6 24h1v1H6zM25 24h1v1H25zM6 25h2v1H6zM13 25h1v1H13zM24 25h1v1H24zM15 26h9v1H15z" />\n  </svg>',
};

export const permissions = {
  cookies: [
    {
      id: "account_0",
      origin: "https://www.kuaishou.com",
      path_prefix: "/",
      names: [
        "kpf",
        "clientid",
        "did",
        "kwpsecproductname",
        "userId",
        "kpn",
        "kuaishou.server.web_st",
        "kuaishou.server.web_ph",
        "kuaishou.server.webday7_st",
        "kuaishou.server.webday7_ph",
        "kwfv1",
        "kwssectoken",
        "kwscode",
      ],
      purpose: "读取用户授权的 快手用户作品 页面或接口",
    },
  ],
};
export class KuaishouUserRSS extends RSSScript {
  async fetch(ctx) {
    try {
      const user_id = String(ctx.params?.user_id || "");
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(user_id)) {
        return Result.Err("user_id 无效", "INVALID_PARAMETER");
      }
      const link = "https://www.kuaishou.com/profile/" + user_id;
      let result;
      try {
        const result_1 = await KuaishouUserRSS.request_text(
          ctx,
          "https://www.kuaishou.com/rest/v/profile/feed",
          {
            method: "POST",
            kuaishou_sign: true,
            body: JSON.stringify({
              user_id,
              pcursor: "",
              page: "profile",
            }),
            cookie_headers: {
              kww: "kwfv1",
            },
            headers: {
              Accept: "application/json, text/plain, */*",
              "Content-Type": "application/json",
              Origin: "https://www.kuaishou.com",
              Referer: link,
              profile_referer: "",
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
            },
          },
        );
        if (result_1.error) throw result_1.error;
        const result_2 = parseJSON(result_1.data);
        if (result_2.error) throw result_2.error;
        result = result_2.data;
        if (result?.result === 50) {
          return Result.Err(
            "快手作品接口签名验证失败（result=50）；主页 HTTP 200 不代表作品接口可用，请检查官方签名 SDK 版本及登录验证状态",
            "UPSTREAM_ACCESS_DENIED",
          );
        }
        if (result?.result !== 1 || !Array.isArray(result.feeds)) {
          throw Object.assign(
            new Error(
              "快手接口拒绝请求或未返回作品列表，请检查登录状态与上游验证",
            ),
            {
              name: "FeedError",
              code: "UPSTREAM_INVALID_RESPONSE",
            },
          );
        }
      } catch (error) {
        return Result.Err(
          "快手作品读取失败：" +
            (error.message || "请求或响应解析失败") +
            "；请同步完整有效的快手登录与验证 Cookie（包括 webday7_st/ph、kwfv1）",
          error.code ?? "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const account =
        result.feeds.find(function (feed) {
          return feed.author?.id === user_id;
        })?.author || {};
      const name = String(account.name || user_id);
      const seen = new Set();
      const items = [];
      for (const entry of result.feeds) {
        const photo = entry.photo || {};
        const id = String(photo.id || "");
        if (
          !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
          (typeof photo.id === "number" && !Number.isSafeInteger(photo.id))
        ) {
          return Result.Err("快手作品缺少有效 ID", "UPSTREAM_INVALID_RESPONSE");
        }
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        const description = String(photo.caption || photo.originCaption || "");
        const video = KuaishouUserRSS.public_url(
          photo.photoUrl || photo.photoUrls?.[0]?.url,
        );
        const published = Number(photo.timestamp);
        items.push({
          id: "kuaishou:photo:" + id,
          title: description || "快手作品 " + id,
          link: "https://www.kuaishou.com/short-video/" + id,
          description,
          image: KuaishouUserRSS.public_url(photo.coverUrl) || undefined,
          author: {
            name: String(entry.author?.name || name),
            uri: link,
          },
          ...(Number.isFinite(published) && published > 0
            ? {
                published,
              }
            : {}),
          ...(video && !String(entry.type).toUpperCase().includes("IMAGE")
            ? {
                enclosure: {
                  url: video,
                  type: "video/mp4",
                },
              }
            : {}),
        });
      }
      items.sort(function (a, b) {
        return (b.published || 0) - (a.published || 0);
      });
      return Result.Ok({
        id: "kuaishou:user:" + user_id,
        title: name + " 的快手作品",
        link,
        description: "",
        language: "zh-cn",
        author: {
          name,
          uri: link,
        },
        image:
          KuaishouUserRSS.public_url(account.headerUrl) ||
          (ctx.public_origin || "") + "/findrss-logo.png",
        updated: items[0]?.published || null,
        items,
        extra: {
          view: "video",
          show_thumbnails: true,
          proxy_images: true,
          headers: {
            referer: "https://www.kuaishou.com/",
          },
          tags: ["快手"],
        },
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static public_url(value) {
    const url = String(value || "").replace(/^\/\//, "https://");
    return /^https?:\/\//i.test(url) ? url : "";
  }
  static async request_text(ctx, url, options = {}) {
    const permission = permissions.cookies.find((entry) =>
      String(url).startsWith(entry.origin + "/"),
    );
    if (permission) {
      const acquired = await ctx.cookies.get(permission.id);
      if (acquired.error) return acquired;
      return utils.request_text(ctx, url, {
        ...options,
        cookies: acquired.data,
      });
    }
    return utils.request_text(ctx, url, options);
  }
}
const script = new KuaishouUserRSS();
export const route = {
  name: "快手用户作品",
  path: "/kuaishou/profile/:user_id",
  url: "www.kuaishou.com",
  maintainers: ["findrss"],
  example: "/kuaishou/profile/3xuxw5yhgr6f4um",
  parameters: {
    user_id: "主页 /profile/ 后的用户 ID",
  },
  description:
    "通过 profile/feed POST 接口获取最新一页作品，宿主使用固定版本官方 SDK 动态签名；请授权完整的快手登录与验证 Cookie（含 webday7_st/ph、kwfv1）。",
  handler: (ctx) => script.run(ctx),
};
