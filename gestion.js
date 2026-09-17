// Variable de memoria para comensal seleccionado en 1-clic dentro del plano
let comensalSeleccionadoPlano = null;

// ======================= PLANO ARQUITECTÓNICO INTERACTIVO =======================
function abrirPlanoMesaModal(numMesa) {
    const mesa = dataMesas.find(m => parseInt(m.numero) === parseInt(numMesa));
    if (!mesa) return;

    comensalSeleccionadoPlano = null;
    const esNovios = (numMesa === 1);
    const cap = parseInt(mesa.capacidad) || (esNovios ? 10 : 10);
    const ocupantes = listaComensalesGenerales.filter(c => c.mesa !== null && parseInt(c.mesa) === numMesa);

    // Cargar historial de posiciones de asientos para esta mesa
    let mapaAsientos = JSON.parse(localStorage.getItem(`asientos_mesa_${numMesa}`) || '{}');

    // Asignar comensales a sus asientos guardados
    let asientosOcupados = new Array(cap).fill(null);
    let comensalesSinAsiento = [];

    ocupantes.forEach(c => {
        const asientoGuardado = mapaAsientos[c.id_drag];
        if (asientoGuardado !== undefined && asientoGuardado >= 0 && asientoGuardado < cap && !asientosOcupados[asientoGuardado]) {
            asientosOcupados[asientoGuardado] = c;
        } else {
            comensalesSinAsiento.push(c);
        }
    });

    // Sentar en los primeros huecos libres a quienes no tenían puesto guardado
    comensalesSinAsiento.forEach(c => {
        const primerLibre = asientosOcupados.findIndex(slot => slot === null);
        if (primerLibre !== -1) {
            asientosOcupados[primerLibre] = c;
            mapaAsientos[c.id_drag] = primerLibre;
        }
    });
    localStorage.setItem(`asientos_mesa_${numMesa}`, JSON.stringify(mapaAsientos));

    document.getElementById('modalPlanoMesaTitulo').innerText = esNovios ? `👑 Mesa 1 (Los Novios)` : `Mesa ${numMesa} ${mesa.alias ? `— ${mesa.alias}` : ''}`;
    document.getElementById('modalPlanoMesaSubtitulo').innerText = `${ocupantes.length} ocupantes de ${cap} asientos asignados (${cap - ocupantes.length} libres)`;

    // 1. RENDERIZAR LISTA IZQUIERDA DE COMENSALES
    const contLista = document.getElementById('lista-comensales-plano-mesa');
    let htmlLista = "";
    ocupantes.forEach(c => {
        const idxAsiento = asientosOcupados.findIndex(slot => slot && slot.id_drag === c.id_drag);
        const torpedoClass = c.lado === 'Novia' ? 'torpedo-novia' : (c.lado === 'Ambos' ? 'torpedo-ambos' : 'torpedo-novio');
        const torpedoEmoji = c.lado === 'Novia' ? '👰' : (c.lado === 'Ambos' ? '💍' : '🤵');
        const numAsientoTexto = idxAsiento !== -1 ? `Silla #${idxAsiento + 1}` : 'Sin silla';

        htmlLista += `
        <div class="plano-comensal-card" id="card-plano-${c.id_drag}" draggable="true" 
             ondragstart="dragPlanoComensal(event, '${c.id_drag}')"
             onclick="seleccionarComensalPlano('${c.id_drag}', ${numMesa})">
            <div class="d-flex align-items-center text-truncate me-2">
                <span class="torpedo-badge ${torpedoClass} me-2">${torpedoEmoji}</span>
                <div class="text-truncate">
                    <strong class="d-block text-truncate" style="font-size:0.83rem;">${escapeHTML(c.nombre_mostrar)}</strong>
                    <small class="text-muted" style="font-size:0.68rem;">${numAsientoTexto}</small>
                </div>
            </div>
            <button class="btn btn-sm text-danger p-0 ms-1" title="Quitar de esta mesa" onclick="event.stopPropagation(); quitarDesdePlanoModal('${c.id_drag}', ${numMesa})">
                <i class="bi bi-x-circle"></i>
            </button>
        </div>`;
    });
    contLista.innerHTML = htmlLista || `<div class="text-muted small text-center py-4">Mesa vacía.</div>`;

    // 2. RENDERIZAR SVG ARQUITECTÓNICO SEGÚN SEA REDONDA O NOVIOS (RECTANGULAR)
    const contenedorSvg = document.getElementById('contenedor-svg-plano');
    if (esNovios) {
        contenedorSvg.innerHTML = generarSvgMesaNoviosRectangular(numMesa, cap, asientosOcupados);
    } else {
        contenedorSvg.innerHTML = generarSvgMesaRedonda(numMesa, cap, asientosOcupados, mesa.alias);
    }

    new bootstrap.Modal(document.getElementById('modalPlanoMesa')).show();
}

// GENERADOR DE MESA REDONDA INSPIRADO EXACTAMENTE EN TU IMAGEN
function generarSvgMesaRedonda(numMesa, cap, asientosOcupados, aliasMesa) {
    const W = 460, H = 460;
    const cx = W / 2, cy = H / 2;
    const rMesa = 82;        // Radio del círculo de la mesa
    const rSilla = 138;      // Distancia radial hacia el cojín
    const rRespaldo = 160;   // Distancia radial hacia el respaldo curvo

    let svgContent = `
    <svg class="plano-svg-container" viewBox="0 0 ${W} ${H}">
        <!-- MESA CENTRAL CIRCULAR -->
        <circle cx="${cx}" cy="${cy}" r="${rMesa}" class="cad-table-circle" />
        <text x="${cx}" y="${cy - 8}" text-anchor="middle" font-family="'Playfair Display', serif" font-weight="bold" font-size="16" fill="#2d2d2d">Mesa ${numMesa}</text>
        <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-family="'Montserrat', sans-serif" font-size="10" fill="#888">${escapeHTML(aliasMesa || '')}</text>
        <text x="${cx}" y="${cy + 28}" text-anchor="middle" font-family="'Montserrat', sans-serif" font-size="9" font-weight="bold" fill="#b59a7a">${asientosOcupados.filter(Boolean).length}/${cap}</text>
    `;

    // DISTRIBUCIÓN RADIAL EXACTA DE LAS SILLAS
    for (let i = 0; i < cap; i++) {
        const anguloRad = (2 * Math.PI * i) / cap - Math.PI / 2;
        const anguloDeg = (anguloRad * 180) / Math.PI;

        const comensal = asientosOcupados[i];
        const estaOcupado = !!comensal;

        let claseCojin = "seat-cushion empty";
        let claseRespaldo = "seat-backrest";
        let etiquetaHtml = `<text y="3" text-anchor="middle" font-family="'Montserrat', sans-serif" font-size="9" fill="#999">#${i + 1}</text>`;

        if (estaOcupado) {
            claseCojin = comensal.lado === 'Novia' ? "seat-cushion occupied-novia" : (comensal.lado === 'Ambos' ? "seat-cushion occupied-ambos" : "seat-cushion occupied-novio");
            claseRespaldo = comensal.lado === 'Novia' ? "seat-backrest novia" : "seat-backrest novio";
            const emoji = comensal.lado === 'Novia' ? '👰' : (comensal.lado === 'Ambos' ? '💍' : '🤵');
            const primerNombre = escapeHTML(comensal.nombre_mostrar.split(' ')[0]);

            // Mantiene el texto horizontal siempre legible (contra-rotación)
            etiquetaHtml = `
                <text y="-3" text-anchor="middle" font-size="9">${emoji}</text>
                <text y="8" text-anchor="middle" font-family="'Montserrat', sans-serif" font-weight="bold" font-size="8" fill="#2d2d2d">${primerNombre}</text>
            `;
        }

        svgContent += `
        <!-- SILLA #${i + 1} -->
        <g class="cad-chair" data-chair-index="${i}"
           ondragover="allowDropChair(event)" ondragleave="leaveDropChair(event)" ondrop="dropOnChair(event, ${numMesa}, ${i})"
           onclick="clickEnSilla(${numMesa}, ${i})">
            
            <!-- Posicionamiento radial -->
            <g transform="translate(${cx}, ${cy}) rotate(${anguloDeg + 90}) translate(0, -${rSilla})">
                
                <!-- Respaldo curvo según la imagen -->
                <path d="M -18 -18 A 24 24 0 0 1 18 -18" class="${claseRespaldo}" />
                
                <!-- Cojín redondeado -->
                <rect x="-14" y="-14" width="28" height="26" rx="6" ry="6" class="${claseCojin}" />
                
                <!-- Texto horizontal (contra-rotado) -->
                <g transform="rotate(${-(anguloDeg + 90)})">
                    ${etiquetaHtml}
                </g>
            </g>
        </g>`;
    }

    svgContent += `</svg>`;
    return svgContent;
}

// GENERADOR DE MESA 1 (LOS NOVIOS - RECTANGULAR)
function generarSvgMesaNoviosRectangular(numMesa, cap, asientosOcupados) {
    const W = 500, H = 340;
    const cx = W / 2, cy = H / 2;
    const mesaW = 220, mesaH = 90;

    let svgContent = `
    <svg class="plano-svg-container" viewBox="0 0 ${W} ${H}">
        <!-- MESA RECTANGULAR IMPERIAL NOVIOS -->
        <rect x="${cx - mesaW/2}" y="${cy - mesaH/2}" width="${mesaW}" height="${mesaH}" rx="10" ry="10" class="cad-table-circle novios" />
        <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-family="'Playfair Display', serif" font-weight="bold" font-size="16" fill="#b59a7a">👑 Mesa 1: Los Novios</text>
        <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-family="'Montserrat', sans-serif" font-size="10" font-weight="bold" fill="#2d2d2d">${asientosOcupados.filter(Boolean).length}/${cap} asientos</text>
    `;

    // Distribución a lo largo del perímetro rectangular
    // Arriba (4), Abajo (4), Izquierda (1), Derecha (1)
    const posicionesSillas = [];
    const sillasArriba = Math.ceil((cap - 2) / 2);
    const sillasAbajo = Math.floor((cap - 2) / 2);

    // Sillas arriba
    for (let i = 0; i < sillasArriba; i++) {
        const x = (cx - mesaW/2 + 30) + (i * ((mesaW - 60) / Math.max(1, sillasArriba - 1)));
        posicionesSillas.push({ x: x, y: cy - mesaH/2 - 28, rot: 0 });
    }
    // Silla derecha
    posicionesSillas.push({ x: cx + mesaW/2 + 28, y: cy, rot: 90 });
    // Sillas abajo
    for (let i = sillasAbajo - 1; i >= 0; i--) {
        const x = (cx - mesaW/2 + 30) + (i * ((mesaW - 60) / Math.max(1, sillasAbajo - 1)));
        posicionesSillas.push({ x: x, y: cy + mesaH/2 + 28, rot: 180 });
    }
    // Silla izquierda
    posicionesSillas.push({ x: cx - mesaW/2 - 28, y: cy, rot: 270 });

    for (let i = 0; i < Math.min(cap, posicionesSillas.length); i++) {
        const pos = posicionesSillas[i];
        const comensal = asientosOcupados[i];
        const estaOcupado = !!comensal;

        let claseCojin = "seat-cushion empty";
        let claseRespaldo = "seat-backrest";
        let etiquetaHtml = `<text y="3" text-anchor="middle" font-family="'Montserrat', sans-serif" font-size="9" fill="#999">#${i + 1}</text>`;

        if (estaOcupado) {
            claseCojin = comensal.lado === 'Novia' ? "seat-cushion occupied-novia" : "seat-cushion occupied-novio";
            claseRespaldo = comensal.lado === 'Novia' ? "seat-backrest novia" : "seat-backrest novio";
            const emoji = comensal.lado === 'Novia' ? '👰' : '🤵';
            const primerNombre = escapeHTML(comensal.nombre_mostrar.split(' ')[0]);

            etiquetaHtml = `
                <text y="-3" text-anchor="middle" font-size="9">${emoji}</text>
                <text y="8" text-anchor="middle" font-family="'Montserrat', sans-serif" font-weight="bold" font-size="8" fill="#2d2d2d">${primerNombre}</text>
            `;
        }

        svgContent += `
        <g class="cad-chair" data-chair-index="${i}"
           ondragover="allowDropChair(event)" ondragleave="leaveDropChair(event)" ondrop="dropOnChair(event, 1, ${i})"
           onclick="clickEnSilla(1, ${i})">
            
            <g transform="translate(${pos.x}, ${pos.y}) rotate(${pos.rot})">
                <path d="M -18 -18 A 24 24 0 0 1 18 -18" class="${claseRespaldo}" />
                <rect x="-14" y="-14" width="28" height="26" rx="6" ry="6" class="${claseCojin}" />
                <g transform="rotate(${-pos.rot})">
                    ${etiquetaHtml}
                </g>
            </g>
        </g>`;
    }

    svgContent += `</svg>`;
    return svgContent;
}

// ======================= EVENTOS DE ARRASTRE DENTRO DEL PLANO =======================
function dragPlanoComensal(ev, idDrag) {
    ev.stopPropagation();
    ev.dataTransfer.setData("plano-guest-id", idDrag);
}

function allowDropChair(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    const g = ev.currentTarget;
    if (g) g.classList.add('dragover-chair');
}

function leaveDropChair(ev) {
    const g = ev.currentTarget;
    if (g) g.classList.remove('dragover-chair');
}

function dropOnChair(ev, numMesa, targetChairIndex) {
    ev.preventDefault();
    ev.stopPropagation();
    const g = ev.currentTarget;
    if (g) g.classList.remove('dragover-chair');

    const idDrag = ev.dataTransfer.getData("plano-guest-id");
    if (!idDrag) return;

    asignarComensalASilla(idDrag, numMesa, targetChairIndex);
}

function seleccionarComensalPlano(idDrag, numMesa) {
    document.querySelectorAll('.plano-comensal-card').forEach(c => c.classList.remove('selected-to-seat'));
    
    if (comensalSeleccionadoPlano === idDrag) {
        comensalSeleccionadoPlano = null;
        return;
    }

    comensalSeleccionadoPlano = idDrag;
    const card = document.getElementById(`card-plano-${idDrag}`);
    if (card) card.classList.add('selected-to-seat');
}

function clickEnSilla(numMesa, chairIndex) {
    if (comensalSeleccionadoPlano) {
        asignarComensalASilla(comensalSeleccionadoPlano, numMesa, chairIndex);
        comensalSeleccionadoPlano = null;
    }
}

function asignarComensalASilla(idDrag, numMesa, targetChairIndex) {
    let mapaAsientos = JSON.parse(localStorage.getItem(`asientos_mesa_${numMesa}`) || '{}');

    // Si la silla ya estaba ocupada por otra persona, intercambiar puestos (SWAP)
    let idAnteriorEnEsaSilla = null;
    for (const [id, sillaIdx] of Object.entries(mapaAsientos)) {
        if (sillaIdx === targetChairIndex && id !== idDrag) {
            idAnteriorEnEsaSilla = id;
            break;
        }
    }

    const sillaAnteriorDelNuevo = mapaAsientos[idDrag];
    mapaAsientos[idDrag] = targetChairIndex;

    if (idAnteriorEnEsaSilla) {
        if (sillaAnteriorDelNuevo !== undefined) {
            mapaAsientos[idAnteriorEnEsaSilla] = sillaAnteriorDelNuevo;
        } else {
            delete mapaAsientos[idAnteriorEnEsaSilla];
        }
    }

    localStorage.setItem(`asientos_mesa_${numMesa}`, JSON.stringify(mapaAsientos));
    abrirPlanoMesaModal(numMesa);
    marcarCambioPendienteMesas();
}

function quitarDesdePlanoModal(idDrag, numMesa) {
    guardarEstadoHistorial();
    const c = listaComensalesGenerales.find(x => x.id_drag === idDrag);
    if (c) c.mesa = null;

    let mapaAsientos = JSON.parse(localStorage.getItem(`asientos_mesa_${numMesa}`) || '{}');
    delete mapaAsientos[idDrag];
    localStorage.setItem(`asientos_mesa_${numMesa}`, JSON.stringify(mapaAsientos));

    dibujarPanelMesas();
    dibujarPanelBanqueteria();
    marcarCambioPendienteMesas();
    abrirPlanoMesaModal(numMesa);
}