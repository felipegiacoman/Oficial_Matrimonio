// URL directa a tu Cloudflare Worker
const WORKER_URL_DEFAULT = "https://rsvp-api.felipegiacoman.workers.dev";
let SCRIPT_URL = WORKER_URL_DEFAULT;
let CSV_FIESTA_URL = localStorage.getItem('urlGoogleSheetFiesta') || "fiesta.csv";

let dataMaestra = []; 
let dataConfirmados = []; 
let dataCancelados = []; 
let dataMesas = [];
let listaComensalesGenerales = []; 
let listaCancelables = []; 
let listaPendientes = []; 
let tarjetasDietas = [];
let listaInvitadosFiesta = [];
let listaDesglosadaMaestra = [];
let comensalModalActivo = null;
let mesaModalActiva = null;

let filtroActualBanqueteria = 'Todas';
let filtroMesasEstado = 'todas';
let filtroLadoMaestraActual = 'todos';

// Control de cambios pendientes en mesas
let hayCambiosMesas = false;

function marcarCambioPendienteMesas() {
    hayCambiosMesas = true;
    const btn = document.getElementById('btn-guardar-cambios-mesas');
    const btnTexto = document.getElementById('btn-guardar-texto');
    if (btn) btn.className = "btn btn-warning fw-bold px-3 py-2 shadow";
    if (btnTexto) btnTexto.innerHTML = `Guardar Cambios <span class="badge bg-danger ms-1">Pendiente</span>`;
}

function marcarCambiosGuardadosMesas() {
    hayCambiosMesas = false;
    const btn = document.getElementById('btn-guardar-cambios-mesas');
    const btnTexto = document.getElementById('btn-guardar-texto');
    if (btn) btn.className = "btn btn-success fw-bold px-3 py-2 shadow-sm";
    if (btnTexto) {
        btnTexto.innerHTML = `<i class="bi bi-check2-circle me-1"></i>¡Guardado!`;
        setTimeout(() => {
            if (!hayCambiosMesas && btnTexto) btnTexto.innerText = "Guardar Cambios";
        }, 2500);
    }
}

window.addEventListener('beforeunload', (e) => {
    if (hayCambiosMesas) {
        e.preventDefault();
        e.returnValue = 'Tienes cambios en las mesas sin guardar. ¿Deseas salir?';
    }
});

// ======================= SISTEMA AUTO-SCROLL EN ARRASTRE =======================
let autoScrollTimer = null;
let autoScrollSpeed = 0;

function manejarAutoScroll(ev) {
    const umbral = 130;
    const altura = window.innerHeight;
    const y = ev.clientY;

    if (y < umbral) {
        autoScrollSpeed = -Math.max(10, Math.round((umbral - y) / 3));
    } else if (y > altura - umbral) {
        autoScrollSpeed = Math.max(10, Math.round((y - (altura - umbral)) / 3));
    } else {
        autoScrollSpeed = 0;
    }

    if (autoScrollSpeed !== 0 && !autoScrollTimer) {
        autoScrollTimer = setInterval(() => {
            window.scrollBy(0, autoScrollSpeed);
        }, 16);
    } else if (autoScrollSpeed === 0 && autoScrollTimer) {
        detenerAutoScroll();
    }
}

function detenerAutoScroll() {
    if (autoScrollTimer) {
        clearInterval(autoScrollTimer);
        autoScrollTimer = null;
    }
    autoScrollSpeed = 0;
}

window.addEventListener('dragover', manejarAutoScroll);
window.addEventListener('dragend', detenerAutoScroll);
window.addEventListener('drop', detenerAutoScroll);

// ======================= SISTEMA DE SINCRONIZACIÓN COLA =======================
let syncQueue = JSON.parse(localStorage.getItem('matriSyncQueue') || '[]');
let isSyncing = false;

function saveQueue() { localStorage.setItem('matriSyncQueue', JSON.stringify(syncQueue)); actualizarEstadoRed(); }
function addToQueue(action) { syncQueue.push(action); saveQueue(); processQueue(); }

async function processQueue() {
    if (isSyncing || syncQueue.length === 0) return;
    isSyncing = true; actualizarEstadoRed();
    while (syncQueue.length > 0) {
        const action = syncQueue[0];
        try {
            await fetch(SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(action)
            });
            syncQueue.shift(); 
            saveQueue();
        } catch (error) {
            console.warn("Reintentando acción...", error);
            isSyncing = false; actualizarEstadoRed();
            setTimeout(processQueue, 3000); 
            return;
        }
    }
    isSyncing = false; actualizarEstadoRed();
}

function actualizarEstadoRed() {
    const el = document.getElementById('network-status'); if (!el) return;
    if (syncQueue.length > 0) {
        el.innerHTML = `<i class="bi bi-arrow-repeat spin me-2"></i> Sincronizando (${syncQueue.length})...`;
        el.style.background = 'rgba(212, 175, 55, 0.95)'; el.style.display = 'block';
    } else {
        el.innerHTML = `<i class="bi bi-check-circle-fill me-2"></i> Cambios guardados en D1`;
        el.style.background = 'rgba(40, 167, 69, 0.95)';
        setTimeout(() => { if (syncQueue.length === 0) el.style.display = 'none'; }, 2000);
    }
}

function quitarTildes(str) { return str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : ""; }
function escapeHTML(str) { return str ? str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag])) : ""; }

// ======================= PARSER CSV FIESTA =======================
function parseCSV(text) {
    let r = [], row = [''], q = false;
    for (let i = 0; i < text.length; i++) {
        let c = text[i], next = text[i+1];
        if (c === '"') {
            if (q && next === '"') { row[row.length - 1] += '"'; i++; }
            else { q = !q; }
        } else if (c === ',' && !q) {
            row.push('');
        } else if ((c === '\r' || c === '\n') && !q) {
            if (c === '\r' && next === '\n') { i++; }
            r.push(row); row = [''];
        } else {
            row[row.length - 1] += c;
        }
    }
    if (row.length > 1 || row[0] !== '') r.push(row);
    return r;
}

function procesarTextoCSVFiesta(csvText) {
    const rows = parseCSV(csvText.trim());
    if (rows.length < 2) return [];

    let invitados = [];
    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (r.length < 3) continue;
        const nombre = (r[1] || '').trim();
        const asiste = (r[2] || '').trim().toLowerCase();
        const parejaVal = (r[3] || '').trim().toLowerCase();
        const notas = (r[4] || '').trim();

        if (!nombre) continue;
        const siAsiste = asiste.includes('si') || asiste.includes('sí');
        if (!siAsiste) continue;

        const tienePareja = parejaVal === 'si' || parejaVal === 'sí';

        invitados.push({ nombre: nombre, es_pareja: false, nombre_principal: nombre });
        if (tienePareja) {
            let nombrePareja = `Pareja de ${nombre}`;
            if (notas && notas.split(/\s+/).length <= 4 && !notas.includes('.') && !notas.includes('!') && !notas.toLowerCase().includes('gracias') && !notas.toLowerCase().includes('aviso')) {
                nombrePareja = `${notas} (Pareja de ${nombre})`;
            }
            invitados.push({ nombre: nombrePareja, es_pareja: true, nombre_principal: nombre });
        }
    }
    return invitados;
}

async function cargarDatosFiesta() {
    const statusEl = document.getElementById('status-sheet-sync');
    const inputUrl = document.getElementById('input-sheet-url');
    if (inputUrl && CSV_FIESTA_URL.startsWith('http')) inputUrl.value = CSV_FIESTA_URL;

    try {
        let fetchUrl = CSV_FIESTA_URL;
        if (fetchUrl.startsWith('http') && SCRIPT_URL) {
            fetchUrl = `${SCRIPT_URL}?action=proxy_csv&url=${encodeURIComponent(CSV_FIESTA_URL)}`;
        }

        let res = await fetch(fetchUrl);
        if (!res.ok) throw new Error("No se pudo cargar");
        let text = await res.text();
        
        if (text && text.length > 20) {
            localStorage.setItem('cacheFiestaCSV', text);
            listaInvitadosFiesta = procesarTextoCSVFiesta(text);
            if (statusEl) statusEl.innerHTML = `<span class="text-success"><i class="bi bi-check-circle me-1"></i>Sincronizado (${listaInvitadosFiesta.length} comensales)</span>`;
        }
    } catch (e) {
        let cached = localStorage.getItem('cacheFiestaCSV');
        if (cached) {
            listaInvitadosFiesta = procesarTextoCSVFiesta(cached);
            if (statusEl) statusEl.innerHTML = `<span class="text-muted"><i class="bi bi-info-circle me-1"></i>Copia en memoria (${listaInvitadosFiesta.length} comensales)</span>`;
        }
    }
    actualizarContadoresFiesta();
    dibujarTablaFiesta();
}

function guardarYRecargarSheet() {
    const url = document.getElementById('input-sheet-url').value.trim();
    if (!url) return alert("Pega un enlace de Google Sheets publicado como CSV.");
    CSV_FIESTA_URL = url;
    localStorage.setItem('urlGoogleSheetFiesta', url);
    cargarDatosFiesta();
}

function cargarCSVLocalFiesta(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
        const text = evt.target.result;
        localStorage.setItem('cacheFiestaCSV', text);
        listaInvitadosFiesta = procesarTextoCSVFiesta(text);
        actualizarContadoresFiesta();
        dibujarTablaFiesta();
        alert(`¡CSV cargado! ${listaInvitadosFiesta.length} personas de fiesta.`);
    };
    reader.readAsText(file);
}

function actualizarContadoresFiesta() {
    const total = listaInvitadosFiesta.length;
    document.getElementById('val-fiesta').innerText = total;
    document.getElementById('tab-count-fiesta').innerText = total;
    document.getElementById('fiesta-banquet-val').innerText = total;
}

function dibujarTablaFiesta() {
    const term = quitarTildes((document.getElementById('buscador-fiesta')?.value || '').toLowerCase().trim());
    let html = "";
    let idx = 1;

    listaInvitadosFiesta.forEach(f => {
        if (term === "" || quitarTildes(f.nombre.toLowerCase()).includes(term)) {
            html += `<tr ${f.es_pareja ? 'style="background-color: #fdfbf7;"' : ''}>
                <td class="text-muted fw-bold">${idx++}</td>
                <td class="${f.es_pareja ? 'ps-4' : ''}">
                    ${f.es_pareja ? '<span class="text-muted me-1">↳</span>' : ''}
                    <strong ${f.es_pareja ? 'class="fw-semibold text-secondary"' : ''}>${escapeHTML(f.nombre)}</strong>
                </td>
                <td>
                    <span class="badge ${f.es_pareja ? 'bg-secondary' : 'text-white'}" style="${!f.es_pareja ? 'background:var(--fiesta-color);' : ''}">
                        ${f.es_pareja ? 'Pareja' : 'Titular'}
                    </span>
                </td>
            </tr>`;
        }
    });

    document.getElementById('tabla-fiesta').innerHTML = html || `<tr><td colspan="3" class="text-center text-muted py-4">No hay invitados de fiesta registrados.</td></tr>`;
}

function exportarExcelFiesta() {
    let data = listaInvitadosFiesta.map((f, i) => ({
        "#": i + 1, "Nombre": f.nombre, "Tipo": f.es_pareja ? "Pareja" : "Titular"
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Invitados Fiesta");
    XLSX.writeFile(wb, "Matrimonio_Fiesta.xlsx");
}

// ======================= CARGA INICIAL =======================
async function init() {
    const relojEl = document.getElementById('reloj-guardado');
    if (relojEl) relojEl.innerHTML = `<span class="text-muted"><i class="bi bi-arrow-repeat spin me-1"></i>Conectando a Cloudflare D1...</span>`;

    try {
        const resCfg = await fetch('config.json').catch(() => null); 
        if (resCfg && resCfg.ok) {
            const cfg = await resCfg.json();
            if (cfg.worker_url) SCRIPT_URL = cfg.worker_url;
            if (!localStorage.getItem('urlGoogleSheetFiesta') && cfg.csv_fiesta_url) {
                CSV_FIESTA_URL = cfg.csv_fiesta_url;
            }
        }
    } catch(e) {
        console.warn("Usando worker por defecto:", SCRIPT_URL);
    }

    try {
        await cargarDatos();
        cargarDatosFiesta().catch(e => console.warn(e));
        processQueue();
    } catch(e) {
        console.error("Error inicial:", e);
        if (relojEl) relojEl.innerHTML = `<span class="text-danger"><i class="bi bi-x-circle me-1"></i>Error de conexión</span>`;
    }
}

async function cargarDatos() {
    const relojEl = document.getElementById('reloj-guardado');
    try {
        const [resM, resConf, resCanc, resMesas] = await Promise.all([
            fetch(`${SCRIPT_URL}?action=lista`).then(r => r.json()).catch(() => []),
            fetch(`${SCRIPT_URL}?action=confirmados`).then(r => r.json()).catch(() => []),
            fetch(`${SCRIPT_URL}?action=cancelados`).then(r => r.json()).catch(() => []),
            fetch(`${SCRIPT_URL}?action=mesas`).then(r => r.json()).catch(() => [])
        ]);

        dataMaestra = Array.isArray(resM) ? resM : [];
        dataConfirmados = Array.isArray(resConf) ? resConf : [];
        dataCancelados = Array.isArray(resCanc) ? resCanc : [];
        dataMesas = Array.isArray(resMesas) ? resMesas : [];

        // MIGRACIÓN Y PROTECCIÓN DE MESA 1 (LOS NOVIOS)
        const mesaCero = dataMesas.find(m => parseInt(m.numero) === 0);
        if (mesaCero) {
            dataConfirmados.forEach(c => {
                if (parseInt(c.mesa_numero) === 0) c.mesa_numero = 1;
                if (parseInt(c.mesa_pareja) === 0) c.mesa_pareja = 1;
            });
            const mesaUno = dataMesas.find(m => parseInt(m.numero) === 1);
            if (mesaUno) {
                mesaUno.alias = mesaCero.alias || "Mesa de los Novios";
            } else {
                mesaCero.numero = 1;
                mesaCero.alias = mesaCero.alias || "Mesa de los Novios";
            }
            dataMesas = dataMesas.filter(m => parseInt(m.numero) !== 0);
        }

        // Asegurar que Mesa 1 siempre exista como la Mesa de Honor
        if (!dataMesas.some(m => parseInt(m.numero) === 1)) {
            dataMesas.unshift({ numero: 1, capacidad: 10, alias: 'Mesa de los Novios' });
        }

        // Ordenar estrictamente: Mesa 1 de primera, luego 2, 3, 4...
        dataMesas.sort((a, b) => parseInt(a.numero) - parseInt(b.numero));

        procesarDatosGenerales(); 
        dibujarPanelBanqueteria(); 
        dibujarPanelConfirmaciones(); 
        dibujarPanelMesas();
        dibujarTablaListaMaestra();

        if (relojEl) {
            relojEl.innerHTML = `<span class="text-success"><i class="bi bi-shield-check me-1"></i>Conectado a D1 (${dataConfirmados.length} confirmados · ${dataMesas.length} mesas)</span>`;
        }
    } catch(e) { 
        console.error("Error en cargarDatos:", e); 
        if (relojEl) relojEl.innerHTML = `<span class="text-danger"><i class="bi bi-wifi-off me-1"></i>Error de conexión</span>`;
    }
}

function procesarDatosGenerales() {
    listaComensalesGenerales = []; 
    listaCancelables = []; 
    listaPendientes = [];
    listaDesglosadaMaestra = [];

    dataMaestra.forEach(m => {
        listaCancelables.push({ nombre_mostrar: m.nombre, nombre_principal: m.nombre, es_pareja: false });

        const conf = dataConfirmados.find(c => c.nombre_invitado === m.nombre);
        const estaConfirmado = !!conf;
        const titularCancelado = dataCancelados.some(c => quitarTildes(c.nombre.toLowerCase()) === quitarTildes(m.nombre.toLowerCase()));

        let estadoTitular = 'Pendiente';
        if (estaConfirmado) estadoTitular = 'Confirmado';
        else if (titularCancelado) estadoTitular = 'Cancelado';

        listaDesglosadaMaestra.push({
            id_maestra: m.id,
            nombre: m.nombre,
            nombre_principal: m.nombre,
            es_pareja: false,
            pareja_activa: parseInt(m.pareja) === 1,
            nino: parseInt(m.nino) === 1,
            lado: m.lado || 'Novio',
            estado: estadoTitular
        });

        if (parseInt(m.pareja) === 1) {
            const parejaConfirmada = conf && conf.lleva_pareja === "Sí";
            const nombreParejaPotencial = (conf && conf.nombre_pareja && conf.nombre_pareja !== '-' && conf.nombre_pareja.toLowerCase() !== 'pendiente') 
                ? conf.nombre_pareja 
                : `Pareja de ${m.nombre}`;

            const parejaCancelada = dataCancelados.some(c => {
                const cNom = quitarTildes(c.nombre.toLowerCase());
                return cNom === quitarTildes(nombreParejaPotencial.toLowerCase()) || 
                       cNom === quitarTildes(`Pareja de ${m.nombre}`.toLowerCase());
            });

            let estadoPareja = 'Pendiente';
            if (parejaConfirmada) estadoPareja = 'Confirmado';
            else if (parejaCancelada) estadoPareja = 'Cancelado';

            listaDesglosadaMaestra.push({
                id_maestra: m.id,
                nombre: nombreParejaPotencial,
                nombre_principal: m.nombre,
                es_pareja: true,
                pareja_activa: true,
                nino: false,
                lado: m.lado || 'Novio',
                estado: estadoPareja
            });

            if (!parejaConfirmada && !parejaCancelada) {
                listaPendientes.push({
                    nombre: nombreParejaPotencial,
                    tipo: 'Pareja',
                    nombre_principal: m.nombre,
                    es_pareja: true,
                    tiene_pareja_maestra: true
                });
            }
        }

        if (!estaConfirmado && !titularCancelado) {
            listaPendientes.push({
                nombre: m.nombre,
                tipo: 'Titular',
                nombre_principal: m.nombre,
                es_pareja: false,
                tiene_pareja_maestra: parseInt(m.pareja) === 1
            });
        }
    });

    dataConfirmados.forEach(c => {
        const infoMaestra = dataMaestra.find(m => m.nombre === c.nombre_invitado);
        const esNinoTitular = infoMaestra ? (infoMaestra.nino === 1) : false;
        const ladoTitular = infoMaestra ? (infoMaestra.lado || 'Novio') : 'Novio';
        
        listaComensalesGenerales.push({
            id_drag: `prin_${c.nombre_invitado}`,
            nombre_mostrar: c.nombre_invitado,
            nombre_principal: c.nombre_invitado,
            es_pareja: false,
            mesa: (c.mesa_numero !== null && c.mesa_numero !== undefined && c.mesa_numero !== "") ? parseInt(c.mesa_numero) : null,
            dieta: c.dieta || 'Ninguna',
            esNino: esNinoTitular,
            lado: ladoTitular,
            telefono: c.telefono,
            lleva_pareja: c.lleva_pareja
        });

        if (c.lleva_pareja === "Sí") {
            let nombreP = (c.nombre_pareja && c.nombre_pareja !== "-" && c.nombre_pareja.toLowerCase() !== "pendiente") 
                ? `${c.nombre_pareja}` 
                : `Pareja de ${c.nombre_invitado}`;
                
            listaComensalesGenerales.push({
                id_drag: `par_${c.nombre_invitado}`,
                nombre_mostrar: nombreP,
                nombre_principal: c.nombre_invitado,
                es_pareja: true,
                mesa: (c.mesa_pareja !== null && c.mesa_pareja !== undefined && c.mesa_pareja !== "") ? parseInt(c.mesa_pareja) : null,
                dieta: c.dieta_pareja || 'Ninguna',
                esNino: false,
                lado: ladoTitular,
                telefono: "-"
            });
            listaCancelables.push({ nombre_mostrar: nombreP, nombre_principal: c.nombre_invitado, es_pareja: true });
        }
    });
}

// =========================================================================
//         GUARDADO MAESTRO EN BBDD CON EL BOTÓN "GUARDAR CAMBIOS"
// =========================================================================
async function guardarCambiosEnBBDD() {
    const btn = document.getElementById('btn-guardar-cambios-mesas');
    const btnTexto = document.getElementById('btn-guardar-texto');
    if (btn) btn.disabled = true;
    if (btnTexto) btnTexto.innerText = "Guardando en D1...";

    // Asegurar Mesa 1 presente
    if (!dataMesas.some(m => parseInt(m.numero) === 1)) {
        dataMesas.unshift({ numero: 1, capacidad: 10, alias: 'Mesa de los Novios' });
    }

    const mesasPayload = dataMesas.map(m => ({
        numero: parseInt(m.numero),
        capacidad: parseInt(m.capacidad),
        alias: m.alias || ''
    }));

    const asignacionesPayload = listaComensalesGenerales.map(c => ({
        nombre_principal: c.nombre_principal,
        es_pareja: c.es_pareja,
        mesa_numero: (c.mesa !== null && c.mesa !== undefined && c.mesa !== "") ? parseInt(c.mesa) : null
    }));

    try {
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tipo: "guardar_todo_mesas",
                mesas: mesasPayload,
                asignaciones: asignacionesPayload
            })
        });
        const resJson = await res.json();
        if (resJson.error) throw new Error(resJson.error);

        marcarCambiosGuardadosMesas();
        alert("✅ ¡Plano de mesas y comensales guardados con éxito en Cloudflare D1!");
    } catch(err) {
        console.error("Error guardando mesas:", err);
        alert("❌ Error al guardar en D1: " + err.message);
        marcarCambioPendienteMesas();
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ======================= MESAS (MESA 1 FIJA Y DESPLAZAMIENTO 2..N) =======================
function obtenerProximoNumeroDisponible() {
    const ocupados = dataMesas
        .map(m => parseInt(m.numero))
        .filter(n => n >= 2);
    let proximo = 2; // Las mesas normales parten desde la 2
    while (ocupados.includes(proximo)) {
        proximo++;
    }
    return proximo;
}

function calcularDesplazamientoMesas(viejoNum, nuevoNum) {
    viejoNum = parseInt(viejoNum);
    nuevoNum = parseInt(nuevoNum);

    if (viejoNum === nuevoNum || isNaN(viejoNum) || isNaN(nuevoNum)) return [];

    // MESA 1 INMUNIZADA
    if (viejoNum === 1 || nuevoNum === 1) {
        alert("La Mesa 1 es la Mesa de los Novios y está fija en esa posición.");
        return [];
    }

    // Solo se reordenan mesas normales (>= 2)
    const mesasNormales = dataMesas
        .filter(m => parseInt(m.numero) >= 2)
        .sort((a, b) => parseInt(a.numero) - parseInt(b.numero));

    const existeDestino = mesasNormales.some(m => parseInt(m.numero) === nuevoNum);
    const mapeo = [];

    if (!existeDestino) {
        mapeo.push({ viejo: viejoNum, nuevo: nuevoNum });
    } else {
        if (viejoNum > nuevoNum) {
            mesasNormales.forEach(m => {
                const num = parseInt(m.numero);
                if (num >= nuevoNum && num < viejoNum) {
                    mapeo.push({ viejo: num, nuevo: num + 1 });
                }
            });
            mapeo.push({ viejo: viejoNum, nuevo: nuevoNum });
        } else {
            mesasNormales.forEach(m => {
                const num = parseInt(m.numero);
                if (num > viejoNum && num <= nuevoNum) {
                    mapeo.push({ viejo: num, nuevo: num - 1 });
                }
            });
            mapeo.push({ viejo: viejoNum, nuevo: nuevoNum });
        }
    }
    return mapeo;
}

function ejecutarCambioNumeroMesa(viejoNum, nuevoNumDeseado) {
    viejoNum = parseInt(viejoNum);
    nuevoNumDeseado = parseInt(nuevoNumDeseado);

    if (isNaN(viejoNum) || isNaN(nuevoNumDeseado) || viejoNum === nuevoNumDeseado) return;
    if (viejoNum === 1 || nuevoNumDeseado === 1) {
        alert("La Mesa 1 es exclusiva de los Novios y no se puede mover.");
        return;
    }

    const mapeo = calcularDesplazamientoMesas(viejoNum, nuevoNumDeseado);
    if (mapeo.length === 0) return;

    listaComensalesGenerales.forEach(c => {
        if (c.mesa !== null) {
            const mNum = parseInt(c.mesa);
            const cambio = mapeo.find(x => x.viejo === mNum);
            if (cambio) c.mesa = cambio.nuevo;
        }
    });

    mapeo.forEach(item => {
        const mesa = dataMesas.find(m => parseInt(m.numero) === item.viejo);
        if (mesa) mesa.numero = item.nuevo;
    });

    dataMesas.sort((a, b) => parseInt(a.numero) - parseInt(b.numero));

    dibujarPanelMesas();
    dibujarPanelBanqueteria();
    marcarCambioPendienteMesas();
}

function dibujarPanelMesas() {
    actualizarKPIMesas();
    dibujarListaSinAsignar();
    dibujarGridMesas();
    dibujarResumenMesasBanqueteria();
}

function actualizarKPIMesas() {
    const sinAsignar = listaComensalesGenerales.filter(c => c.mesa === null || c.mesa === "");
    let sillasTotales = 0, sillasOcupadas = 0;
    
    dataMesas.forEach(m => {
        const ocupantes = listaComensalesGenerales.filter(c => c.mesa !== null && parseInt(c.mesa) === parseInt(m.numero)).length;
        sillasOcupadas += ocupantes;
        sillasTotales += parseInt(m.capacidad);
    });

    const pct = sillasTotales > 0 ? Math.round((sillasOcupadas / sillasTotales) * 100) : 0;
    document.getElementById('kpi-mesas-totales').innerText = dataMesas.length;
    document.getElementById('kpi-sillas-ocupadas').innerText = sillasOcupadas;
    document.getElementById('kpi-sillas-totales').innerText = sillasTotales;
    document.getElementById('kpi-pct-ocupacion').innerText = `${pct}%`;
    document.getElementById('kpi-sin-mesa').innerText = sinAsignar.length;
    document.getElementById('count-sin-asignar').innerText = sinAsignar.length;
}

function dibujarListaSinAsignar() {
    const sinAsignar = listaComensalesGenerales.filter(c => c.mesa === null || c.mesa === "");
    const term = quitarTildes((document.getElementById('buscador-por-asignar')?.value || '').toLowerCase().trim());
    
    let html = "";
    sinAsignar.forEach(c => {
        if (term === "" || quitarTildes(c.nombre_mostrar.toLowerCase()).includes(term)) {
            const torpedoBg = c.lado === 'Novia' ? 'var(--color-novia)' : (c.lado === 'Ambos' ? 'var(--color-ambos)' : 'var(--color-novio)');
            const torpedoEmoji = c.lado === 'Novia' ? '👰' : (c.lado === 'Ambos' ? '💍' : '🤵');

            html += `
            <div class="guest-item-pro ${c.esNino ? 'is-child' : ''}" draggable="true" ondragstart="dragGuest(event, '${c.id_drag}')">
                <div class="d-flex align-items-center text-truncate me-2">
                    <span class="torpedo-badge me-2 text-white" style="background-color: ${torpedoBg};" title="Lado: ${c.lado}">${torpedoEmoji}</span>
                    <div class="text-truncate">
                        <span class="fw-bold d-block text-truncate" title="${escapeHTML(c.nombre_mostrar)}">${escapeHTML(c.nombre_mostrar)}</span>
                        <small class="text-muted" style="font-size:0.7rem;">
                            ${c.esNino ? '<span class="badge badge-nino me-1">Niño</span>' : ''}
                            ${c.es_pareja ? '<span class="badge bg-light text-secondary border">Pareja</span>' : ''}
                        </small>
                    </div>
                </div>
                <button class="btn btn-outline-dark btn-sm py-0 px-2 flex-shrink-0" style="font-size:0.72rem;" onclick="abrirModalAsignarDirecto('${c.id_drag}')">
                    <i class="bi bi-arrow-right-short"></i> Sentar
                </button>
            </div>`;
        }
    });
    document.getElementById('lista-sin-asignar').innerHTML = html || `<div class="text-center text-muted small py-4"><i class="bi bi-check2-all text-success fs-3 d-block mb-1"></i>Todos tienen mesa asignada</div>`;
}

function filtrarPorAsignar() { dibujarListaSinAsignar(); }

function dibujarGridMesas() {
    let htmlGrid = "";
    dataMesas.forEach(mesa => {
        const num = parseInt(mesa.numero);
        const esMesaNovios = (num === 1); // Mesa 1 es SIEMPRE la mesa de los novios
        const ocupantes = listaComensalesGenerales.filter(c => c.mesa !== null && parseInt(c.mesa) === num);
        const cant = ocupantes.length;
        const cap = parseInt(mesa.capacidad);
        const estaLlena = (cant >= cap);

        if (filtroMesasEstado === 'disponibles' && estaLlena) return;
        if (filtroMesasEstado === 'llenas' && !estaLlena) return;
        if (filtroMesasEstado === 'novios' && !esMesaNovios) return;

        const pctBar = Math.min(100, Math.round((cant / cap) * 100));
        let colorBar = pctBar >= 100 ? 'bg-dark' : (pctBar >= 75 ? 'bg-warning' : 'bg-success');

        let htmlOcupantes = "";
        ocupantes.forEach(c => {
            const torpedoBg = c.lado === 'Novia' ? 'var(--color-novia)' : (c.lado === 'Ambos' ? 'var(--color-ambos)' : 'var(--color-novio)');
            const torpedoEmoji = c.lado === 'Novia' ? '👰' : (c.lado === 'Ambos' ? '💍' : '🤵');

            htmlOcupantes += `
            <div class="guest-item-pro ${c.esNino ? 'is-child' : ''}" draggable="true" ondragstart="dragGuest(event, '${c.id_drag}')">
                <div class="d-flex align-items-center text-truncate me-2">
                    <span class="torpedo-badge me-2 text-white" style="background-color: ${torpedoBg};" title="Lado: ${c.lado}">${torpedoEmoji}</span>
                    <div class="text-truncate">
                        <span class="d-block text-truncate fw-semibold" style="font-size:0.83rem;" title="${escapeHTML(c.nombre_mostrar)}">${escapeHTML(c.nombre_mostrar)}</span>
                        <small class="text-muted" style="font-size:0.68rem;">
                            ${c.esNino ? '<span class="badge badge-nino me-1">Niño</span>' : ''}
                            ${c.es_pareja ? '<span class="text-secondary">Pareja</span>' : ''}
                        </small>
                    </div>
                </div>
                <div class="d-flex align-items-center gap-1">
                    <button class="btn btn-sm btn-light border py-0 px-1 text-muted" title="Mover a otra mesa" onclick="abrirModalAsignarDirecto('${c.id_drag}', ${num})"><i class="bi bi-arrow-left-right" style="font-size:0.75rem;"></i></button>
                    <button class="btn btn-sm btn-light border py-0 px-1 text-danger" title="Quitar" onclick="intentarAsignar('${c.id_drag}', null, null, null)"><i class="bi bi-x-lg" style="font-size:0.75rem;"></i></button>
                </div>
            </div>`;
        });

        const alias = mesa.alias || (esMesaNovios ? 'Los Novios (Mesa de Honor)' : 'Clic para asignar nombre');

        htmlGrid += `
        <div class="col-12 col-md-6 col-xxl-4 mesa-col-box" id="mesa-col-${num}" 
             ${!esMesaNovios ? `ondragover="allowDropMesa(event)" ondragleave="leaveDropMesa(event)" ondrop="dropMesa(event, ${num})"` : ''}>
            
            <div class="mesa-card-pro ${esMesaNovios ? 'mesa-novios' : ''}">
                <div class="mesa-header" ${!esMesaNovios ? `draggable="true" ondragstart="dragMesa(event, ${num})"` : ''}>
                    <div class="d-flex justify-content-between align-items-start">
                        <div>
                            <div class="d-flex align-items-center gap-2">
                                ${!esMesaNovios ? '<i class="bi bi-grip-vertical text-muted cursor-grab-mesa" title="Arrastra para reordenar esta mesa"></i>' : ''}
                                <h6 class="m-0 fw-bold" style="font-family:'Playfair Display', serif; font-size:1.1rem;">
                                    ${esMesaNovios ? '👑 Mesa 1: Los Novios' : `Mesa ${num}`}
                                </h6>
                                <div class="dropdown">
                                    <button class="btn btn-sm btn-light py-0 px-1 text-muted border-0" data-bs-toggle="dropdown"><i class="bi bi-three-dots-vertical"></i></button>
                                    <ul class="dropdown-menu dropdown-menu-end shadow-sm small">
                                        <li><a class="dropdown-item" href="javascript:void(0)" onclick="editarAliasMesa(${num})"><i class="bi bi-pencil me-2"></i>Renombrar / Alias</a></li>
                                        <li><a class="dropdown-item" href="javascript:void(0)" onclick="cambiarCapacidad(${num}, ${cap})"><i class="bi bi-people me-2"></i>Cambiar sillas</a></li>
                                        ${!esMesaNovios ? `<li><a class="dropdown-item" href="javascript:void(0)" onclick="cambiarNumero(${num})"><i class="bi bi-123 me-2"></i>Cambiar número</a></li>` : ''}
                                        <li><a class="dropdown-item text-warning" href="javascript:void(0)" onclick="vaciarMesaCompleta(${num})"><i class="bi bi-arrow-counterclockwise me-2"></i>Vaciar mesa</a></li>
                                        ${!esMesaNovios ? `<li><hr class="dropdown-divider"></li><li><a class="dropdown-item text-danger" href="javascript:void(0)" onclick="eliminarMesa(${num})"><i class="bi bi-trash me-2"></i>Eliminar mesa</a></li>` : ''}
                                    </ul>
                                </div>
                            </div>
                            <div class="mesa-alias" onclick="editarAliasMesa(${num})">${escapeHTML(alias)}</div>
                        </div>
                        <span class="badge ${estaLlena ? 'bg-dark' : 'bg-success'} px-2 py-1" style="font-size:0.75rem;">
                            ${cant} / ${cap} sillas
                        </span>
                    </div>
                    <div class="progress-seats"><div class="progress-bar ${colorBar}" style="width: ${pctBar}%"></div></div>
                </div>

                <div class="drop-zone-pro" ondragover="allowDropGuest(event)" ondragleave="leaveDropGuest(event)" ondrop="dropGuest(event, ${num}, ${cap}, ${cant})">
                    ${htmlOcupantes || '<div class="text-center text-muted small py-4" style="border:1px dashed #e8e2d8; border-radius:6px;"><i class="bi bi-box-arrow-in-down d-block mb-1"></i>Mesa vacía</div>'}
                </div>

                <div class="p-2 border-top bg-light text-center" style="border-radius: 0 0 12px 12px;">
                    <button class="btn btn-sm btn-outline-dark w-100 py-1" style="font-size:0.75rem;" onclick="abrirModalSentarEnMesa(${num}, ${cap}, ${cant})" ${estaLlena ? 'disabled' : ''}>
                        <i class="bi bi-person-plus me-1"></i> ${estaLlena ? 'Mesa Completa' : 'Sentar comensal aquí'}
                    </button>
                </div>
            </div>
        </div>`;
    });

    document.getElementById('contenedor-mesas').innerHTML = htmlGrid || `<div class="col-12 text-center text-muted py-5">No hay mesas en esta categoría.</div>`;
}

// ======================= DRAG & DROP GESTIÓN =======================
function dragGuest(ev, idDrag) {
    ev.stopPropagation();
    ev.dataTransfer.setData("drag-type", "guest");
    ev.dataTransfer.setData("text/plain", idDrag);
}

function allowDropGuest(ev) {
    ev.preventDefault(); ev.stopPropagation();
    const d = ev.target.closest('.drop-zone-pro');
    if (d) d.classList.add('dragover');
}

function leaveDropGuest(ev) {
    const d = ev.target.closest('.drop-zone-pro');
    if (d) d.classList.remove('dragover');
}

function dropGuest(ev, mesaNum, capMax, capActual) {
    ev.preventDefault(); ev.stopPropagation();
    detenerAutoScroll();
    const d = ev.target.closest('.drop-zone-pro');
    if (d) d.classList.remove('dragover');

    if (ev.dataTransfer.getData("drag-type") !== "guest") return;
    const idDrag = ev.dataTransfer.getData("text/plain");
    if (!idDrag) return;
    intentarAsignar(idDrag, mesaNum, capMax, capActual);
}

function dragMesa(ev, mesaNum) {
    if (parseInt(mesaNum) === 1) {
        ev.preventDefault(); return;
    }
    ev.stopPropagation();
    ev.dataTransfer.setData("drag-type", "mesa");
    ev.dataTransfer.setData("text/plain", mesaNum.toString());
}

function allowDropMesa(ev) {
    if (ev.dataTransfer.types.includes("drag-type")) {
        ev.preventDefault();
        const card = ev.currentTarget.querySelector('.mesa-card-pro');
        if (card && !card.classList.contains('mesa-novios')) card.classList.add('dragover-mesa');
    }
}

function leaveDropMesa(ev) {
    const card = ev.currentTarget.querySelector('.mesa-card-pro');
    if (card) card.classList.remove('dragover-mesa');
}

function dropMesa(ev, targetMesaNum) {
    ev.preventDefault(); ev.stopPropagation();
    detenerAutoScroll();
    const card = ev.currentTarget.querySelector('.mesa-card-pro');
    if (card) card.classList.remove('dragover-mesa');

    if (ev.dataTransfer.getData("drag-type") !== "mesa") return;
    const origenNum = parseInt(ev.dataTransfer.getData("text/plain"));
    const destinoNum = parseInt(targetMesaNum);

    if (origenNum === 1 || destinoNum === 1) {
        alert("La Mesa 1 es la Mesa de los Novios y no se puede mover.");
        return;
    }

    if (origenNum !== destinoNum) {
        ejecutarCambioNumeroMesa(origenNum, destinoNum);
    }
}

function intentarAsignar(idDrag, mesaNum, capMax, capActual) {
    if(!idDrag) return; 
    const comensal = listaComensalesGenerales.find(c => c.id_drag === idDrag); 
    if (!comensal) return;
    
    if (mesaNum !== null && comensal.mesa !== null && parseInt(comensal.mesa) === parseInt(mesaNum)) return;
    if (mesaNum !== null && parseInt(capMax) !== 999 && (capActual + 1 > capMax)) { 
        alert(`¡Faltan sillas! Solo quedan ${capMax - capActual} puestos disponibles.`); 
        return; 
    }

    comensal.mesa = mesaNum; 
    dibujarPanelMesas(); 
    dibujarPanelBanqueteria(); 
    marcarCambioPendienteMesas();
}

function cambiarNumero(viejoNum) {
    if (parseInt(viejoNum) === 1) return alert("La Mesa 1 de los Novios no se puede cambiar de número.");
    const nuevoNum = prompt(`Cambiar Mesa ${viejoNum} al número:`); 
    if(!nuevoNum || isNaN(nuevoNum)) return;
    ejecutarCambioNumeroMesa(parseInt(viejoNum), parseInt(nuevoNum));
}

function crearMesa(num, cap) { 
    dataMesas.push({ numero: num, capacidad: cap, alias: '' }); 
    dataMesas.sort((a,b) => parseInt(a.numero) - parseInt(b.numero));
    dibujarPanelMesas(); 
    marcarCambioPendienteMesas();
}

function abrirModalCrearMesa() {
    const cap = prompt("Cantidad de sillas para la nueva mesa (Ej: 10 u 8):", "10");
    if(!cap || isNaN(cap) || parseInt(cap) <= 0) return;
    crearMesa(obtenerProximoNumeroDisponible(), parseInt(cap));
}

function eliminarMesa(num) { 
    if (parseInt(num) === 1) return alert("La Mesa 1 de los Novios no se puede eliminar.");
    if(!confirm(`¿Eliminar la Mesa ${num}? Los comensales volverán a 'Por Asignar'.`)) return; 
    
    dataMesas = dataMesas.filter(m => parseInt(m.numero) !== parseInt(num)); 
    listaComensalesGenerales.forEach(c => { if(parseInt(c.mesa) === parseInt(num)) c.mesa = null; }); 
    
    dibujarPanelMesas(); 
    dibujarPanelBanqueteria(); 
    marcarCambioPendienteMesas();
}

function cambiarCapacidad(numero, capActual) {
    const nuevaCap = prompt(`Nueva cantidad de sillas:`, capActual); 
    if(!nuevaCap || isNaN(nuevaCap) || parseInt(nuevaCap) <= 0) return;
    const mesa = dataMesas.find(m => parseInt(m.numero) === parseInt(numero)); 
    if(mesa) mesa.capacidad = parseInt(nuevaCap); 
    
    dibujarPanelMesas(); 
    marcarCambioPendienteMesas();
}

function editarAliasMesa(num) {
    const mesaObj = dataMesas.find(m => parseInt(m.numero) === parseInt(num));
    const actual = mesaObj ? (mesaObj.alias || "") : "";
    const nuevo = prompt(`Asigna un alias a la Mesa ${num}:`, actual);
    if(nuevo === null) return;
    
    const aliasFinal = nuevo.trim();
    if(mesaObj) mesaObj.alias = aliasFinal;
    
    dibujarGridMesas();
    dibujarResumenMesasBanqueteria();
    marcarCambioPendienteMesas();
}

function vaciarMesaCompleta(num) {
    const ocupantes = listaComensalesGenerales.filter(c => c.mesa !== null && parseInt(c.mesa) === parseInt(num));
    if(ocupantes.length === 0) return alert("La mesa ya está vacía.");
    if(!confirm(`¿Quitar a los ${ocupantes.length} comensales de la Mesa ${num}? Volverán a 'Por Asignar'.`)) return;

    ocupantes.forEach(c => { c.mesa = null; });
    dibujarPanelMesas(); 
    dibujarPanelBanqueteria(); 
    marcarCambioPendienteMesas();
}

// ======================= MODAL 1-CLIC =======================
function abrirModalAsignarDirecto(idDrag, mesaActual = null) {
    const comensal = listaComensalesGenerales.find(c => c.id_drag === idDrag);
    if(!comensal) return;
    comensalModalActivo = comensal;

    document.getElementById('modalMoverMesaTitulo').innerText = `Asignar a: ${comensal.nombre_mostrar}`;
    document.getElementById('modalMoverMesaSubtitulo').innerText = mesaActual !== null 
        ? `Actualmente en Mesa ${mesaActual}.` : `Aún no tiene mesa asignada.`;

    const select = document.getElementById('select-destino-mesa');
    select.innerHTML = "";

    if (mesaActual !== null) {
        const optSin = document.createElement('option');
        optSin.value = "desasignar";
        optSin.innerText = "❌ Quitar de la mesa (Mover a 'Por Asignar')";
        select.appendChild(optSin);
    }

    dataMesas.forEach(m => {
        const num = parseInt(m.numero);
        const esNovios = (num === 1);
        const ocupantes = listaComensalesGenerales.filter(c => c.mesa !== null && parseInt(c.mesa) === num).length;
        const cap = parseInt(m.capacidad);
        const alias = m.alias ? ` (${m.alias})` : '';

        const opt = document.createElement('option');
        opt.value = num;
        opt.innerText = esNovios ? `👑 Mesa 1: Los Novios${alias} — (${ocupantes}/${cap} ocupados)` : `Mesa ${num}${alias} — (${ocupantes}/${cap} ocupados)`;
        
        if (ocupantes >= cap && num !== mesaActual) {
            opt.disabled = true;
            opt.innerText += " [LLENA]";
        }
        if (num === mesaActual) opt.selected = true;
        select.appendChild(opt);
    });

    new bootstrap.Modal(document.getElementById('modalMoverMesa')).show();
}

function ejecutarMoverDesdeModal() {
    if(!comensalModalActivo) return;
    const selectVal = document.getElementById('select-destino-mesa').value;
    bootstrap.Modal.getInstance(document.getElementById('modalMoverMesa')).hide();

    if (selectVal === "desasignar") {
        intentarAsignar(comensalModalActivo.id_drag, null, null, null);
    } else {
        const mesaNum = parseInt(selectVal);
        const mesaObj = dataMesas.find(m => parseInt(m.numero) === mesaNum);
        const cap = mesaObj ? parseInt(mesaObj.capacidad) : 10;
        const ocupados = listaComensalesGenerales.filter(c => c.mesa !== null && parseInt(c.mesa) === mesaNum).length;
        intentarAsignar(comensalModalActivo.id_drag, mesaNum, cap, ocupados);
    }
}

let candidatosSinMesaGlobal = [];
function abrirModalSentarEnMesa(numMesa, capMax, capActual) {
    mesaModalActiva = { num: numMesa, capMax: capMax, capActual: capActual };
    candidatosSinMesaGlobal = listaComensalesGenerales.filter(c => c.mesa === null || c.mesa === "");
    
    document.getElementById('modalSentarMesaTitulo').innerText = (numMesa === 1) ? `Sentar en Mesa 1 (Los Novios)` : `Sentar en Mesa ${numMesa}`;
    document.getElementById('modal-buscar-sin-asignar').value = "";
    renderListaModalSinAsignar(candidatosSinMesaGlobal);
    new bootstrap.Modal(document.getElementById('modalSentarEnMesa')).show();
}

function renderListaModalSinAsignar(lista) {
    const cont = document.getElementById('modal-lista-candidatos');
    if(lista.length === 0) {
        cont.innerHTML = `<div class="p-3 text-center text-muted small">No hay comensales sin mesa.</div>`;
        return;
    }
    let html = "";
    lista.forEach(c => {
        const torpedoBg = c.lado === 'Novia' ? 'var(--color-novia)' : (c.lado === 'Ambos' ? 'var(--color-ambos)' : 'var(--color-novio)');
        const torpedoEmoji = c.lado === 'Novia' ? '👰' : (c.lado === 'Ambos' ? '💍' : '🤵');

        html += `
        <button type="button" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" onclick="ejecutarSentarDesdeModal('${c.id_drag}')">
            <div class="d-flex align-items-center">
                <span class="torpedo-badge me-2 text-white" style="background-color: ${torpedoBg};">${torpedoEmoji}</span>
                <div>
                    <strong style="font-size:0.88rem;">${escapeHTML(c.nombre_mostrar)}</strong>
                    <div class="small text-muted">${c.es_pareja ? 'Pareja' : 'Titular'}</div>
                </div>
            </div>
            <span class="btn btn-sm btn-gold py-0 px-2">Sentar</span>
        </button>`;
    });
    cont.innerHTML = html;
}

function filtrarModalSinAsignar(val) {
    const term = quitarTildes(val.toLowerCase().trim());
    renderListaModalSinAsignar(candidatosSinMesaGlobal.filter(c => quitarTildes(c.nombre_mostrar.toLowerCase()).includes(term)));
}

function ejecutarSentarDesdeModal(idDrag) {
    if(!mesaModalActiva) return;
    bootstrap.Modal.getInstance(document.getElementById('modalSentarEnMesa')).hide();
    intentarAsignar(idDrag, mesaModalActiva.num, mesaModalActiva.capMax, mesaModalActiva.capActual);
}

function buscarComensalEnMesas(val) {
    const term = quitarTildes(val.toLowerCase().trim());
    document.querySelectorAll('.mesa-card-pro').forEach(card => card.classList.remove('highlight-mesa'));
    if(term.length < 2) return;

    const coincidencia = listaComensalesGenerales.find(c => c.mesa !== null && quitarTildes(c.nombre_mostrar.toLowerCase()).includes(term));
    if(coincidencia) {
        const mesaCol = document.getElementById(`mesa-col-${coincidencia.mesa}`);
        if(mesaCol) {
            const card = mesaCol.querySelector('.mesa-card-pro');
            if(card) {
                card.classList.add('highlight-mesa');
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }
}

function filtrarMesasVista(tipo) {
    filtroMesasEstado = tipo;
    document.querySelectorAll('[id^="filtro-mesa-"]').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`filtro-mesa-${tipo}`).classList.add('active');
    dibujarGridMesas();
}

// ======================= BANQUETERÍA =======================
function dibujarPanelBanqueteria() {
    let adultos = 0, ninos = 0, dietasDinamicas = {};
    listaComensalesGenerales.forEach(c => {
        if (c.esNino) ninos++; else adultos++;
        if (c.dieta !== "Ninguna" && c.dieta !== "-") dietasDinamicas[c.dieta] = (dietasDinamicas[c.dieta] || 0) + 1;
    });

    document.getElementById('adult-val').innerText = adultos; 
    document.getElementById('nino-val').innerText = ninos;
    document.getElementById('fiesta-banquet-val').innerText = listaInvitadosFiesta.length;

    const contenedorDietas = document.getElementById('contenedor-dietas'); contenedorDietas.innerHTML = ""; tarjetasDietas = [];
    if (Object.keys(dietasDinamicas).length === 0) contenedorDietas.innerHTML = `<div class="col-12"><p class="text-muted small">No hay comensales con dietas especiales registradas.</p></div>`;

    for (const [dieta, cantidad] of Object.entries(dietasDinamicas)) {
        const col = document.createElement('div'); col.className = 'col-6 col-md-3 col-lg-2';
        const card = document.createElement('div'); card.className = 'stat-card filtrable';
        card.onclick = () => renderTablaBanqueteria(dieta);
        tarjetasDietas.push({ elemento: card, nombreDieta: dieta });
        card.innerHTML = `<h6 class="small fw-bold text-truncate m-0 mb-2" title="${dieta}">${dieta}</h6><div class="stat-val">${cantidad}</div>`;
        col.appendChild(card); contenedorDietas.appendChild(col);
    }
    renderTablaBanqueteria(filtroActualBanqueteria);
    dibujarResumenMesasBanqueteria();
}

function dibujarResumenMesasBanqueteria() {
    const cont = document.getElementById('contenedor-mesas-banquetera');
    if (!cont) return;

    let html = "";
    dataMesas.forEach(m => {
        const num = parseInt(m.numero);
        const esNovios = (num === 1);
        const ocupantes = listaComensalesGenerales.filter(c => c.mesa !== null && parseInt(c.mesa) === num);
        
        let adultosMesa = 0, ninosMesa = 0;
        let especiales = [];

        ocupantes.forEach(o => {
            if (o.esNino) {
                ninosMesa++;
                especiales.push({ nombre: o.nombre_mostrar, plato: "Menú Infantil (Niño)" });
            } else {
                adultosMesa++;
            }

            if (o.dieta && o.dieta !== "Ninguna" && o.dieta !== "-") {
                especiales.push({ nombre: o.nombre_mostrar, plato: o.dieta });
            }
        });

        const aliasText = m.alias ? ` - ${escapeHTML(m.alias)}` : '';
        const tituloMesa = esNovios ? `👑 Mesa 1: Los Novios${aliasText}` : `Mesa ${num}${aliasText}`;

        let htmlEspeciales = "";
        if (especiales.length > 0) {
            htmlEspeciales = `<div class="p-2 mb-2 rounded" style="background:#fff7e6; border:1px solid #ffd591;">
                <span class="d-block small fw-bold text-dark mb-1"><i class="bi bi-exclamation-triangle-fill text-warning me-1"></i>Platos Especiales (${especiales.length}):</span>
                <ul class="mb-0 ps-3 small" style="font-size:0.78rem;">
                    ${especiales.map(e => `<li><strong>${escapeHTML(e.nombre)}:</strong> <span class="text-danger fw-semibold">${escapeHTML(e.plato)}</span></li>`).join('')}
                </ul>
            </div>`;
        } else {
            htmlEspeciales = `<div class="small text-success mb-2"><i class="bi bi-check-circle-fill me-1"></i>Todos comen Menú Adulto Estándar</div>`;
        }

        html += `
        <div class="col-12 col-md-6 col-lg-4">
            <div class="bg-white p-3 rounded-3 shadow-sm border h-100" style="border-top: 4px solid ${esNovios ? '#d4af37' : 'var(--oro)'} !important;">
                <div class="d-flex justify-content-between align-items-center mb-2 pb-2 border-bottom">
                    <h6 class="m-0 fw-bold" style="font-family:'Playfair Display', serif;">${tituloMesa}</h6>
                    <span class="badge bg-dark">${ocupantes.length} sentados</span>
                </div>
                <div class="small text-muted mb-2">
                    <span>Adultos: <strong>${adultosMesa}</strong></span> · 
                    <span>Niños: <strong>${ninosMesa}</strong></span>
                </div>
                ${htmlEspeciales}
                <div class="small text-muted border-top pt-2" style="font-size:0.75rem;">
                    <span class="fw-bold d-block mb-1">Comensales en mesa:</span>
                    ${ocupantes.length ? ocupantes.map(o => `<span class="badge bg-light text-dark border me-1 mb-1">${escapeHTML(o.nombre_mostrar)}</span>`).join('') : '<span class="text-muted">Mesa sin comensales</span>'}
                </div>
            </div>
        </div>`;
    });

    cont.innerHTML = html || `<div class="col-12 text-center text-muted py-3">No hay mesas configuradas aún.</div>`;
}

function renderTablaBanqueteria(filtro = filtroActualBanqueteria) {
    filtroActualBanqueteria = filtro;
    const term = quitarTildes(document.getElementById('buscador-banqueteria').value.toLowerCase().trim());
    
    tarjetasDietas.forEach(t => { t.elemento.classList.toggle('active-filter', filtro !== 'Todas' && filtro !== 'Niños' && t.nombreDieta === filtro); });
    document.getElementById('card-ninos').classList.toggle('active-filter', filtro === 'Niños');
    document.getElementById('titulo-tabla-banqueteria').innerText = filtro === 'Todas' ? 'Todos los Comensales Cena' : (filtro === 'Niños' ? 'Filtrando por: Menú Infantil (Niños)' : `Filtrando por: ${filtro}`);

    let html = "";
    listaComensalesGenerales.forEach(c => {
        let matchFiltro = (filtro === 'Todas') || (filtro === 'Niños' && c.esNino) || (filtro !== 'Todas' && filtro !== 'Niños' && c.dieta === filtro);
        let matchSearch = term === "" || quitarTildes(c.nombre_mostrar.toLowerCase()).includes(term);

        if (matchFiltro && matchSearch) {
            const mesaStr = c.mesa ? (parseInt(c.mesa) === 1 ? `👑 Mesa 1 (Novios)` : `Mesa ${c.mesa}`) : `<span class="text-danger small">Sin mesa</span>`;
            html += `<tr ${c.es_pareja ? 'style="background-color: #fdfbf7;"' : ''}>
                <td class="${c.es_pareja ? 'ps-4' : ''}">${c.es_pareja ? '↳ ' : ''}<strong>${escapeHTML(c.nombre_mostrar)}</strong></td>
                <td><span class="badge ${c.es_pareja ? 'bg-secondary' : 'bg-primary'}">${c.es_pareja ? 'Pareja' : 'Titular'}</span></td>
                <td>${mesaStr}</td>
                <td><span class="dieta-editable" title="Click para editar" onclick="editarDietaUI('${c.id_drag}')">${escapeHTML(c.dieta)}</span></td>
                <td><span class="badge ${c.esNino ? 'badge-nino' : 'bg-success'}">${c.esNino ? 'Niño' : 'Adulto'}</span></td>
            </tr>`;
        }
    });
    document.getElementById('lista-tabla-banqueteria').innerHTML = html || `<tr><td colspan="5" class="text-center text-muted">No hay resultados.</td></tr>`;
}

function editarDietaUI(idDrag) {
    const comensal = listaComensalesGenerales.find(c => c.id_drag === idDrag);
    if(!comensal) return;
    const nuevaDieta = prompt(`Escribe la nueva restricción para ${comensal.nombre_mostrar}:`, comensal.dieta);
    if(nuevaDieta === null) return; 
    
    const dietaFinal = nuevaDieta.trim() === "" ? "Ninguna" : nuevaDieta.trim();
    comensal.dieta = dietaFinal;
    
    const conf = dataConfirmados.find(c => c.nombre_invitado === comensal.nombre_principal);
    if(conf) {
        if(comensal.es_pareja) conf.dieta_pareja = dietaFinal;
        else conf.dieta = dietaFinal;
    }

    dibujarPanelBanqueteria(); dibujarPanelConfirmaciones(); dibujarPanelMesas();
    addToQueue({ tipo: "editar_dieta", nombre_principal: comensal.nombre_principal, es_pareja: comensal.es_pareja, nueva_dieta: dietaFinal });
}

// ======================= CONFIRMACIONES CENA =======================
function dibujarPanelConfirmaciones() {
    const term = quitarTildes((document.getElementById('buscador-confirmados')?.value || '').toLowerCase().trim());
    const termPend = quitarTildes((document.getElementById('buscador-pendientes')?.value || '').toLowerCase().trim());

    document.getElementById('val-confirmados').innerText = listaComensalesGenerales.length;
    document.getElementById('val-pendientes').innerText = listaPendientes.length;
    document.getElementById('val-cancelados').innerText = dataCancelados.length;

    let htmlConf = "";
    listaComensalesGenerales.forEach(c => {
        if (term === "" || quitarTildes(c.nombre_mostrar.toLowerCase()).includes(term)) {
            const btnBajar = `<button class="btn btn-sm btn-outline-danger py-0 px-2 me-1" title="Bajar a Cancelados" onclick="bajarDesdeConfirmados('${c.id_drag}')"><i class="bi bi-x-circle"></i> Bajar</button>`;
            const btnMasPareja = (!c.es_pareja && c.lleva_pareja !== 'Sí') 
                ? `<button class="btn btn-sm btn-outline-primary py-0 px-2" title="Agregar acompañante" onclick="agregarParejaAConfirmado('${escapeHTML(c.nombre_principal)}')"><i class="bi bi-person-plus"></i> + Pareja</button>` 
                : '';

            htmlConf += `<tr ${c.es_pareja ? 'style="background-color: #fdfbf7;"' : ''}>
                <td style="white-space: nowrap;">${btnBajar}${btnMasPareja}</td>
                <td class="${c.es_pareja ? 'ps-4' : ''}">${c.es_pareja ? '↳ ' : ''}<strong>${escapeHTML(c.nombre_mostrar)}</strong></td>
                <td><span class="badge ${c.es_pareja ? 'bg-secondary' : 'bg-primary'}">${c.es_pareja ? 'Pareja' : 'Titular'}</span></td>
                <td>${escapeHTML(c.telefono || '-')}</td>
                <td>${escapeHTML(c.dieta)}</td>
            </tr>`;
        }
    });
    document.getElementById('tabla-confirmados').innerHTML = htmlConf || `<tr><td colspan="5" class="text-center text-muted">No hay resultados.</td></tr>`;

    let htmlPend = "";
    listaPendientes.forEach(p => {
        if (termPend === "" || quitarTildes(p.nombre.toLowerCase()).includes(termPend)) {
            const btnConfirmar = `<button class="btn btn-sm btn-outline-success py-0 px-2 me-1" title="Confirmar asistencia" onclick="confirmarDesdePendientes('${escapeHTML(p.nombre_principal)}', ${p.es_pareja}, '${escapeHTML(p.nombre)}')"><i class="bi bi-check-lg"></i></button>`;
            const btnBajar = `<button class="btn btn-sm btn-outline-danger py-0 px-2 me-1" title="Bajar a Cancelados" onclick="cancelarDesdePendientes('${escapeHTML(p.nombre_principal)}', ${p.es_pareja})"><i class="bi bi-x-circle"></i></button>`;
            
            const titularTieneParejaActiva = listaPendientes.some(x => x.nombre_principal === p.nombre_principal && x.es_pareja) || 
                                             dataConfirmados.some(c => c.nombre_invitado === p.nombre_principal && c.lleva_pareja === 'Sí');
            
            const btnHabilitarPareja = (!p.es_pareja && !titularTieneParejaActiva) 
                ? `<button class="btn btn-sm btn-outline-primary py-0 px-2" title="Habilitar Pareja (+1)" onclick="agregarParejaAPendiente('${escapeHTML(p.nombre_principal)}')"><i class="bi bi-person-plus"></i> + Pareja</button>` 
                : '';

            htmlPend += `<tr ${p.tipo === 'Pareja' ? 'style="background-color: #fdfbf7;"' : ''}>
                <td style="white-space: nowrap;">${btnConfirmar}${btnBajar}${btnHabilitarPareja}</td>
                <td class="${p.tipo === 'Pareja' ? 'ps-4' : ''}">${p.tipo === 'Pareja' ? '↳ ' : ''}<strong>${escapeHTML(p.nombre)}</strong></td>
                <td><span class="badge ${p.tipo === 'Pareja' ? 'bg-secondary' : 'bg-warning text-dark'}">${p.tipo}</span></td>
            </tr>`;
        }
    });
    document.getElementById('tabla-pendientes').innerHTML = htmlPend || `<tr><td colspan="3" class="text-center text-muted">No hay resultados.</td></tr>`;

    let htmlCanc = "";
    dataCancelados.forEach(c => {
        htmlCanc += `<tr><td><strong>${escapeHTML(c.nombre)}</strong></td><td><span class="text-muted small">${escapeHTML(c.mensaje || '-')}</span></td></tr>`;
    });
    document.getElementById('tabla-cancelados').innerHTML = htmlCanc || `<tr><td colspan="2" class="text-center text-muted">No hay resultados.</td></tr>`;
}

function bajarDesdeConfirmados(idDrag) {
    const comensal = listaComensalesGenerales.find(c => c.id_drag === idDrag);
    if (!comensal) return;

    if (comensal.es_pareja) {
        if (!confirm(`¿Dar de baja a la pareja ${comensal.nombre_mostrar}?`)) return;
        const conf = dataConfirmados.find(c => c.nombre_invitado === comensal.nombre_principal);
        if (conf) { conf.lleva_pareja = 'No'; conf.nombre_pareja = '-'; conf.dieta_pareja = '-'; conf.mesa_pareja = null; }
        dataCancelados.push({ nombre: comensal.nombre_mostrar, mensaje: 'Cancelada manualmente' });
        addToQueue({ tipo: "admin_cancelar", nombre_principal: comensal.nombre_principal, es_pareja: true });
    } else {
        const conf = dataConfirmados.find(c => c.nombre_invitado === comensal.nombre_principal);
        const tienePareja = conf && conf.lleva_pareja === 'Sí';
        let advertencia = `¿Dar de baja a ${comensal.nombre_mostrar}?`;
        if (tienePareja) advertencia += `\nSu pareja registrada (${conf.nombre_pareja || 'Pareja'}) también será dada de baja.`;
        if (!confirm(advertencia)) return;

        dataConfirmados = dataConfirmados.filter(c => c.nombre_invitado !== comensal.nombre_principal);
        dataCancelados.push({ nombre: comensal.nombre_mostrar, mensaje: 'Cancelado manualmente' });
        if (tienePareja) {
            let nPareja = (conf.nombre_pareja && conf.nombre_pareja !== '-' && conf.nombre_pareja.toLowerCase() !== 'pendiente') ? conf.nombre_pareja : `Pareja de ${comensal.nombre_principal}`;
            dataCancelados.push({ nombre: nPareja, mensaje: 'Cancelado junto al titular' });
        }
        addToQueue({ tipo: "admin_cancelar", nombre_principal: comensal.nombre_principal, es_pareja: false });
    }

    procesarDatosGenerales(); dibujarPanelConfirmaciones(); dibujarPanelBanqueteria(); dibujarPanelMesas(); dibujarTablaListaMaestra();
}

function agregarParejaAConfirmado(nombrePrincipal) {
    const conf = dataConfirmados.find(c => c.nombre_invitado === nombrePrincipal);
    if (!conf) return;

    const nombreP = prompt(`Nombre de la pareja para ${nombrePrincipal}:\n(Deja en blanco para 'Pareja de ${nombrePrincipal}')`);
    if (nombreP === null) return;
    const dietaP = prompt(`Restricción alimentaria de la pareja (opcional):`);
    if (dietaP === null) return;

    const nombreFinal = nombreP.trim() !== "" ? nombreP.trim() : `Pareja de ${nombrePrincipal}`;
    const dietaFinal = dietaP.trim() !== "" ? dietaP.trim() : "Ninguna";

    conf.lleva_pareja = "Sí"; conf.nombre_pareja = nombreFinal; conf.dieta_pareja = dietaFinal;
    const m = dataMaestra.find(item => item.nombre === nombrePrincipal); if (m) m.pareja = 1;

    dataCancelados = dataCancelados.filter(c => {
        const cNom = quitarTildes(c.nombre.toLowerCase());
        return cNom !== quitarTildes(nombreFinal.toLowerCase()) && cNom !== quitarTildes(`Pareja de ${nombrePrincipal}`.toLowerCase());
    });

    procesarDatosGenerales(); dibujarPanelConfirmaciones(); dibujarPanelBanqueteria(); dibujarPanelMesas(); dibujarTablaListaMaestra();
    addToQueue({ tipo: "admin_agregar_pareja_confirmado", nombre_principal: nombrePrincipal, nombre_pareja: nombreFinal, dieta_pareja: dietaFinal });
}

function agregarParejaAPendiente(nombrePrincipal) {
    if (!confirm(`¿Habilitar acompañante (+1) para ${nombrePrincipal}?`)) return;
    const m = dataMaestra.find(item => item.nombre === nombrePrincipal); if (m) m.pareja = 1;
    dataCancelados = dataCancelados.filter(c => quitarTildes(c.nombre.toLowerCase()) !== quitarTildes(`Pareja de ${nombrePrincipal}`.toLowerCase()));
    procesarDatosGenerales(); dibujarPanelConfirmaciones(); dibujarTablaListaMaestra();
    addToQueue({ tipo: "admin_habilitar_pareja", nombre_principal: nombrePrincipal });
}

function confirmarDesdePendientes(nombrePrincipal, esPareja, nombreMostrar) {
    let msg = esPareja ? `¿Confirmar a ${nombreMostrar}?` : `¿Confirmar al titular ${nombrePrincipal}?`;
    if(!confirm(msg)) return;
    
    let conf = dataConfirmados.find(c => c.nombre_invitado === nombrePrincipal);
    if (!esPareja) {
        if (!conf) dataConfirmados.push({ nombre_invitado: nombrePrincipal, lleva_pareja: "No", telefono: "-", dieta: "Ninguna", mesa_numero: null });
        else conf.dieta = "Ninguna";
        dataCancelados = dataCancelados.filter(c => quitarTildes(c.nombre.toLowerCase()) !== quitarTildes(nombrePrincipal.toLowerCase()));
    } else {
        if (conf) { conf.lleva_pareja = "Sí"; conf.nombre_pareja = nombreMostrar; conf.dieta_pareja = "Ninguna"; }
        else { dataConfirmados.push({ nombre_invitado: nombrePrincipal, lleva_pareja: "Sí", nombre_pareja: nombreMostrar, telefono: "-", dieta: "Ninguna", dieta_pareja: "Ninguna", mesa_numero: null }); }
        dataCancelados = dataCancelados.filter(c => {
            const cNom = quitarTildes(c.nombre.toLowerCase());
            return cNom !== quitarTildes(nombreMostrar.toLowerCase()) && cNom !== quitarTildes(`Pareja de ${nombrePrincipal}`.toLowerCase());
        });
    }
    
    procesarDatosGenerales(); dibujarPanelConfirmaciones(); dibujarPanelBanqueteria(); dibujarPanelMesas(); dibujarTablaListaMaestra();
    addToQueue({ tipo: "admin_confirmar", nombre_principal: nombrePrincipal, es_pareja: esPareja });
}

function cancelarDesdePendientes(nombrePrincipal, esPareja) {
    let msg = esPareja ? `¿Bajar a la pareja de ${nombrePrincipal}?` : `¿Bajar al titular ${nombrePrincipal}?`;
    if(!confirm(msg)) return;
    
    if(!esPareja) {
        dataCancelados.push({ nombre: nombrePrincipal, mensaje: "Dado de baja" });
        const ms = dataMaestra.find(m => m.nombre === nombrePrincipal);
        if(ms && parseInt(ms.pareja) === 1) dataCancelados.push({ nombre: `Pareja de ${nombrePrincipal}`, mensaje: "Titular dado de baja" });
    } else {
        dataCancelados.push({ nombre: `Pareja de ${nombrePrincipal}`, mensaje: "Dado de baja" });
    }
    
    procesarDatosGenerales(); dibujarPanelConfirmaciones(); dibujarTablaListaMaestra();
    addToQueue({ tipo: "admin_cancelar", nombre_principal: nombrePrincipal, es_pareja: esPareja });
}

// ======================= LISTA MAESTRA =======================
function dibujarTablaListaMaestra() {
    const term = quitarTildes((document.getElementById('buscador-maestra')?.value || '').toLowerCase().trim());
    
    let totalTitulares = dataMaestra.length;
    let totalParejas = dataMaestra.filter(m => parseInt(m.pareja) === 1).length;
    let totalSillas = totalTitulares + totalParejas;
    
    let countNovio = 0, countNovia = 0, countAmbos = 0;
    listaDesglosadaMaestra.forEach(item => {
        if (item.lado === 'Novia') countNovia++;
        else if (item.lado === 'Ambos') countAmbos++;
        else countNovio++;
    });

    document.getElementById('maestra-total-titulares').innerText = totalTitulares;
    document.getElementById('maestra-total-parejas').innerText = totalParejas;
    document.getElementById('maestra-total-sillas').innerText = totalSillas;
    document.getElementById('maestra-count-novio').innerText = countNovio;
    document.getElementById('maestra-count-novia').innerText = countNovia;
    document.getElementById('maestra-count-ambos').innerText = countAmbos;

    let html = "";
    let numeroCorrelativo = 1;

    listaDesglosadaMaestra.forEach(item => {
        const matchLado = (filtroLadoMaestraActual === 'todos') || (item.lado === filtroLadoMaestraActual);
        const matchBusqueda = term === "" || 
            quitarTildes(item.nombre.toLowerCase()).includes(term) || 
            quitarTildes(item.nombre_principal.toLowerCase()).includes(term);

        const currentNum = numeroCorrelativo++;

        if (matchLado && matchBusqueda) {
            let estadoBadge = '<span class="badge bg-warning text-dark">Pendiente</span>';
            if (item.estado === 'Confirmado') estadoBadge = '<span class="badge bg-success">Confirmado</span>';
            else if (item.estado === 'Cancelado') estadoBadge = '<span class="badge bg-danger">Cancelado</span>';

            let ladoIcon = '🤵 Novio';
            let ladoClass = 'badge-novio';
            if (item.lado === 'Novia') { ladoIcon = '👰 Novia'; ladoClass = 'badge-novia'; }
            else if (item.lado === 'Ambos') { ladoIcon = '💍 Ambos'; ladoClass = 'badge-ambos'; }

            let columnaPareja = '';
            let columnaAcciones = '';

            if (!item.es_pareja) {
                columnaPareja = `
                    <button class="btn btn-sm ${item.pareja_activa ? 'btn-outline-primary' : 'btn-outline-secondary'} py-0 px-2" style="font-size:0.75rem;" onclick="alternarParejaMaestra(${item.id_maestra})">
                        ${item.pareja_activa ? '<i class="bi bi-people-fill me-1"></i>Con Pareja' : '<i class="bi bi-person me-1"></i>Solo'}
                    </button>`;
                
                columnaAcciones = `
                    <button class="btn btn-sm btn-outline-danger py-0 px-2" title="Eliminar titular" onclick="eliminarInvitadoMaestra(${item.id_maestra}, '${escapeHTML(item.nombre)}')">
                        <i class="bi bi-trash"></i>
                    </button>`;
            } else {
                columnaPareja = `<span class="badge bg-light text-secondary border"><i class="bi bi-link-45deg me-1"></i>Acompañante</span>`;
                columnaAcciones = `
                    <button class="btn btn-sm btn-outline-warning py-0 px-2" title="Quitar pareja" onclick="alternarParejaMaestra(${item.id_maestra})">
                        <i class="bi bi-person-dash"></i>
                    </button>`;
            }

            html += `
            <tr ${item.es_pareja ? 'style="background-color: #fcfaf7;"' : ''}>
                <td class="text-muted fw-bold">${currentNum}</td>
                <td class="${item.es_pareja ? 'ps-4' : ''}">
                    ${item.es_pareja ? '<span class="text-muted me-1">↳</span>' : ''}
                    <strong ${item.es_pareja ? 'class="fw-semibold text-secondary"' : ''}>${escapeHTML(item.nombre)}</strong>
                </td>
                <td>
                    <span class="badge ${ladoClass} ${!item.es_pareja ? 'lado-selector' : ''}" ${!item.es_pareja ? `onclick="alternarLadoMaestra(${item.id_maestra})"` : ''}>
                        ${ladoIcon}
                    </span>
                </td>
                <td><span class="badge ${item.es_pareja ? 'bg-secondary' : 'bg-primary'}">${item.es_pareja ? 'Pareja' : 'Titular'}</span></td>
                <td>${columnaPareja}</td>
                <td><span class="badge ${item.nino ? 'badge-nino' : 'bg-light text-dark border'}">${item.nino ? 'Niño' : 'Adulto'}</span></td>
                <td>${estadoBadge}</td>
                <td>${columnaAcciones}</td>
            </tr>`;
        }
    });

    document.getElementById('tabla-lista-maestra').innerHTML = html || `<tr><td colspan="8" class="text-center text-muted py-4">No se encontraron comensales.</td></tr>`;
}

function filtrarLadoMaestra(lado) {
    filtroLadoMaestraActual = lado;
    document.querySelectorAll('[id^="btn-filtro-lado-"]').forEach(btn => btn.classList.remove('active'));
    if (lado === 'todos') document.getElementById('btn-filtro-lado-todos').classList.add('active');
    else if (lado === 'Novio') document.getElementById('btn-filtro-lado-novio').classList.add('active');
    else if (lado === 'Novia') document.getElementById('btn-filtro-lado-novia').classList.add('active');
    else if (lado === 'Ambos') document.getElementById('btn-filtro-lado-ambos').classList.add('active');
    dibujarTablaListaMaestra();
}

function alternarLadoMaestra(id) {
    const item = dataMaestra.find(m => parseInt(m.id) === parseInt(id));
    if (!item) return;

    const orden = ['Novio', 'Novia', 'Ambos'];
    let idx = orden.indexOf(item.lado || 'Novio');
    let nuevoLado = orden[(idx + 1) % orden.length];
    
    item.lado = nuevoLado;
    procesarDatosGenerales();
    dibujarTablaListaMaestra();
    dibujarPanelMesas();
    addToQueue({ tipo: "editar_lado_maestra", id: item.id, lado: nuevoLado });
}

function alternarParejaMaestra(id) {
    const item = dataMaestra.find(m => parseInt(m.id) === parseInt(id));
    if (!item) return;

    const nuevaPareja = parseInt(item.pareja) === 1 ? 0 : 1;
    item.pareja = nuevaPareja;
    
    if (nuevaPareja === 0) {
        const conf = dataConfirmados.find(c => c.nombre_invitado === item.nombre);
        if (conf) {
            conf.lleva_pareja = 'No'; conf.nombre_pareja = '-'; conf.dieta_pareja = '-'; conf.mesa_pareja = null;
        }
    }

    procesarDatosGenerales();
    dibujarTablaListaMaestra();
    dibujarPanelConfirmaciones();
    dibujarPanelBanqueteria();
    dibujarPanelMesas();
    
    addToQueue({ tipo: "editar_pareja_maestra", id: item.id, pareja: nuevaPareja });
}

function abrirModalAgregarInvitado() {
    document.getElementById('modal-nuevo-nombre').value = "";
    document.getElementById('modal-nuevo-lado').value = "Novio";
    document.getElementById('modal-nuevo-pareja').checked = false;
    document.getElementById('modal-nuevo-nino').checked = false;
    new bootstrap.Modal(document.getElementById('modalAgregarInvitado')).show();
}

function guardarInvitadoModalMaestra(e) {
    e.preventDefault();
    const nombre = document.getElementById('modal-nuevo-nombre').value.trim();
    const lado = document.getElementById('modal-nuevo-lado').value;
    const pareja = document.getElementById('modal-nuevo-pareja').checked ? 1 : 0;
    const nino = document.getElementById('modal-nuevo-nino').checked ? 1 : 0;

    if (!nombre) return;
    if (dataMaestra.some(m => quitarTildes(m.nombre.toLowerCase()) === quitarTildes(nombre.toLowerCase()))) {
        alert("Ese invitado ya existe en la lista maestra."); return;
    }

    const proximoId = dataMaestra.reduce((max, obj) => Math.max(max, parseInt(obj.id) || 0), 0) + 1;
    const nuevoObj = { id: proximoId, nombre: nombre, pareja: pareja, nino: nino, lado: lado };
    
    dataMaestra.push(nuevoObj);
    bootstrap.Modal.getInstance(document.getElementById('modalAgregarInvitado')).hide();

    procesarDatosGenerales();
    dibujarTablaListaMaestra();
    dibujarPanelConfirmaciones();

    addToQueue({ tipo: "agregar_maestra", id: proximoId, nombre: nombre, pareja: pareja, nino: nino, lado: lado });
}

function eliminarInvitadoMaestra(id, nombre) {
    if (!confirm(`¿Eliminar a "${nombre}" de la Lista Maestra?`)) return;

    dataMaestra = dataMaestra.filter(m => parseInt(m.id) !== parseInt(id));
    dataConfirmados = dataConfirmados.filter(c => c.nombre_invitado !== nombre);
    dataCancelados = dataCancelados.filter(c => c.nombre !== nombre && c.nombre !== `Pareja de ${nombre}`);
    listaComensalesGenerales = listaComensalesGenerales.filter(c => c.nombre_principal !== nombre);

    procesarDatosGenerales();
    dibujarTablaListaMaestra();
    dibujarPanelConfirmaciones();
    dibujarPanelBanqueteria();
    dibujarPanelMesas();

    addToQueue({ tipo: "eliminar_maestra", id: id, nombre: nombre });
}

function exportarExcelListaMaestra() {
    let data = [];
    let correlativo = 1;
    listaDesglosadaMaestra.forEach(item => {
        data.push({
            "#": correlativo++,
            "Nombre del Comensal": item.nombre,
            "Tipo": item.es_pareja ? "Pareja" : "Titular",
            "Titular": item.nombre_principal,
            "Lado": item.lado,
            "Menú": item.nino ? "Niño" : "Adulto",
            "Estado": item.estado
        });
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Lista Maestra Completa");
    XLSX.writeFile(wb, "Matrimonio_Lista_Maestra.xlsx");
}

// ======================= EXCEL EXPORTS =======================
function exportarExcelMesas() {
    let data = [];
    let invitadosPorMesa = [...listaComensalesGenerales].sort((a, b) => {
        let mA = a.mesa === null ? 9999 : parseInt(a.mesa);
        let mB = b.mesa === null ? 9999 : parseInt(b.mesa);
        return mA - mB;
    });

    invitadosPorMesa.forEach(c => {
        let nombreMesa = "Sin Asignar";
        if(c.mesa !== null && c.mesa !== "") { 
            const numM = parseInt(c.mesa);
            const mesaObj = dataMesas.find(m => parseInt(m.numero) === numM);
            const aliasM = (mesaObj && mesaObj.alias) ? ` (${mesaObj.alias})` : '';
            nombreMesa = numM === 1 ? `👑 Mesa 1 (Los Novios)${aliasM}` : `Mesa ${numM}${aliasM}`; 
        }
        data.push({ 
            "Mesa": nombreMesa, 
            "Nombre": c.nombre_mostrar, 
            "Tipo": c.es_pareja ? "Pareja" : "Titular", 
            "Lado": c.lado,
            "Restricción Alimentaria": c.dieta,
            "Menú": c.esNino ? "Niño" : "Adulto"
        });
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Plano de Mesas");
    XLSX.writeFile(wb, "Matrimonio_Mesas.xlsx");
}

function exportarExcelBanqueteria() {
    let data = listaComensalesGenerales.map(c => ({
        "Nombre": c.nombre_mostrar,
        "Tipo": c.es_pareja ? "Pareja" : "Titular",
        "Mesa": c.mesa ? (parseInt(c.mesa) === 1 ? "👑 Mesa 1 (Novios)" : `Mesa ${c.mesa}`) : "Sin asignar",
        "Restricción Alimentaria": c.dieta,
        "Menú": c.esNino ? "Niño" : "Adulto"
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Banquetería");
    XLSX.writeFile(wb, "Matrimonio_Banqueteria.xlsx");
}

function exportarExcelConfirmaciones() {
    let confData = listaComensalesGenerales.map(c => ({ "Nombre": c.nombre_mostrar, "Tipo": c.es_pareja ? "Pareja" : "Titular", "Teléfono": c.telefono || "-", "Restricción Alimentaria": c.dieta }));
    let pendData = listaPendientes.map(p => ({ "Nombre": p.nombre, "Tipo": p.tipo }));
    let cancData = dataCancelados.map(c => ({ "Nombre": c.nombre, "Motivo": c.mensaje || "-" }));
    let fiestaData = listaInvitadosFiesta.map((f, i) => ({ "#": i + 1, "Nombre": f.nombre, "Tipo": f.es_pareja ? "Pareja" : "Titular" }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(confData), "Cena Confirmados");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(fiestaData), "Fiesta Confirmados");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pendData), "Cena Pendientes");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cancData), "Cena Cancelados");
    XLSX.writeFile(wb, "Matrimonio_Confirmaciones.xlsx");
}

// Auto-arranque si ya estás dentro de la sesión
if (sessionStorage.getItem('matri_unlocked')) {
    init();
}