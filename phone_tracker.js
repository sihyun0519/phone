// 전역 변수
let transactions = [];
let editingTransactionId = null;
let selectedPurchaseId = null;
let isCloudSyncEnabled = false;

// Firebase 설정 (실제 사용 시 본인의 Firebase 프로젝트 설정으로 교체)
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Firebase 초기화
let db = null;
try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    isCloudSyncEnabled = true;
    console.log('Firebase 연결 성공!');
    updateSyncStatus(true);
} catch (error) {
    console.log('Firebase 연결 실패, 로컬 저장소 사용:', error);
    isCloudSyncEnabled = false;
    updateSyncStatus(false);
}

// 동기화 상태 업데이트
function updateSyncStatus(isCloud) {
    const statusElement = document.getElementById('syncStatus');
    if (isCloud) {
        statusElement.innerHTML = '<i class="fas fa-cloud me-1"></i>클라우드 동기화';
        statusElement.className = 'badge bg-success';
    } else {
        statusElement.innerHTML = '<i class="fas fa-hdd me-1"></i>로컬 저장소';
        statusElement.className = 'badge bg-secondary';
    }
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', async function() {
    await loadData();
    updateStats();
    updateTable();
    updateInventory();
    updateAnalytics();
    setDefaultDate();
    
    // 이벤트 리스너 등록
    document.getElementById('transactionForm').addEventListener('submit', handleFormSubmit);
    document.getElementById('searchInput').addEventListener('input', filterTransactions);
    document.getElementById('statusFilter').addEventListener('change', filterTransactions);
    document.getElementById('inventorySearch').addEventListener('input', filterInventory);
    document.getElementById('transactionType').addEventListener('change', handleTransactionTypeChange);
    
    // 탭 변경 이벤트
    document.querySelectorAll('[data-bs-toggle="tab"]').forEach(tab => {
        tab.addEventListener('shown.bs.tab', function(e) {
            if (e.target.getAttribute('data-bs-target') === '#inventory') {
                updateInventory();
            } else if (e.target.getAttribute('data-bs-target') === '#analytics') {
                updateAnalytics();
            }
        });
    });
});

// 기본 날짜 설정 (오늘)
function setDefaultDate() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('transactionDate').value = today;
}

// 폼 제출 처리
function handleFormSubmit(e) {
    e.preventDefault();
    
    const formData = {
        id: editingTransactionId || Date.now(), // 수정 모드면 기존 ID, 아니면 새 ID
        type: document.getElementById('transactionType').value,
        model: document.getElementById('phoneModel').value,
        storage: document.getElementById('storage').value,
        color: document.getElementById('color').value,
        price: parseInt(document.getElementById('price').value),
        date: document.getElementById('transactionDate').value,
        dealer: document.getElementById('dealer').value,
        memo: document.getElementById('memo').value,
        timestamp: editingTransactionId ? new Date().toISOString() : new Date().toISOString()
    };
    
    // 매입/판매 매칭 처리
    if (formData.type === 'sale') {
        // 수정 모드인 경우 기존 매칭 정보 유지
        if (editingTransactionId) {
            const existingSale = transactions.find(t => t.id === editingTransactionId);
            if (existingSale && existingSale.purchaseId) {
                formData.purchaseId = existingSale.purchaseId;
                const purchase = transactions.find(p => p.id === existingSale.purchaseId);
                if (purchase) {
                    formData.profit = formData.price - purchase.price;
                    console.log('수정 모드 - 매칭된 매입:', purchase.model, '매입가:', purchase.price, '판매가:', formData.price, '수익:', formData.profit);
                }
            }
        } else {
            // 새 판매인 경우 매칭 찾기
            if (selectedPurchaseId) {
                // 수동으로 선택된 매입 사용
                const selectedPurchase = transactions.find(p => p.id === selectedPurchaseId);
                if (selectedPurchase) {
                    formData.purchaseId = selectedPurchase.id;
                    formData.profit = formData.price - selectedPurchase.price;
                    console.log('수동 매칭 - 선택된 매입:', selectedPurchase.model, '매입가:', selectedPurchase.price, '판매가:', formData.price, '수익:', formData.profit);
                }
            } else {
                // 자동 매칭
                const matchingPurchase = findMatchingPurchase(formData);
                if (matchingPurchase) {
                    formData.purchaseId = matchingPurchase.id;
                    formData.profit = formData.price - matchingPurchase.price;
                    console.log('자동 매칭 - 매칭된 매입:', matchingPurchase.model, '매입가:', matchingPurchase.price, '판매가:', formData.price, '수익:', formData.profit);
                } else {
                    console.log('매칭되는 매입을 찾을 수 없음:', formData.model);
                }
            }
        }
    }
    
    if (editingTransactionId) {
        // 수정 모드: 기존 거래 업데이트
        const index = transactions.findIndex(t => t.id === editingTransactionId);
        if (index !== -1) {
            transactions[index] = formData;
        }
        editingTransactionId = null;
        
        // 버튼 텍스트 복원
        const submitBtn = document.querySelector('#transactionForm button[type="submit"]');
        submitBtn.innerHTML = '<i class="fas fa-save me-2"></i>저장';
        submitBtn.classList.remove('btn-warning');
        submitBtn.classList.add('btn-primary');
        
        // 취소 버튼 숨김
        document.getElementById('cancelBtn').style.display = 'none';
        
        showAlert('거래가 성공적으로 수정되었습니다!', 'success');
    } else {
        // 새 거래 추가
        transactions.push(formData);
        showAlert('거래가 성공적으로 저장되었습니다!', 'success');
    }
    
    // 선택된 매입 ID 초기화
    selectedPurchaseId = null;
    
    saveData();
    updateStats();
    updateTable();
    updateInventory();
    updateAnalytics();
    
    // 폼 초기화
    e.target.reset();
    setDefaultDate();
}

// 매입/판매 매칭 찾기
function findMatchingPurchase(saleData) {
    // 이미 판매된 매입은 제외
    const soldPurchaseIds = transactions
        .filter(t => t.type === 'sale' && t.purchaseId)
        .map(t => t.purchaseId);
    
    const unsoldPurchases = transactions.filter(t => 
        t.type === 'purchase' && 
        !soldPurchaseIds.includes(t.id) &&
        t.model.toLowerCase().includes(saleData.model.toLowerCase())
    );
    
    console.log('=== 매칭 디버깅 ===');
    console.log('판매 모델:', saleData.model);
    console.log('판매가:', saleData.price);
    console.log('이미 판매된 매입 ID들:', soldPurchaseIds);
    console.log('사용 가능한 매입들:', unsoldPurchases.map(p => ({
        id: p.id,
        model: p.model,
        price: p.price,
        date: p.date
    })));
    
    if (unsoldPurchases.length > 0) {
        // 가장 최근 매입을 우선적으로 매칭
        const matched = unsoldPurchases.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
        console.log('매칭된 매입:', {
            id: matched.id,
            model: matched.model,
            price: matched.price,
            date: matched.date
        });
        console.log('계산된 수익:', saleData.price - matched.price);
        console.log('================');
        return matched;
    }
    
    console.log('매칭되는 매입 없음');
    console.log('================');
    return null;
}

// 통계 업데이트
function updateStats() {
    const totalProfit = calculateTotalProfit();
    const monthlyProfit = calculateMonthlyProfit();
    const totalPurchaseAmount = calculateTotalPurchaseAmount();
    const totalItems = transactions.length;
    const inventoryCount = calculateInventoryCount();
    const avgProfitRate = calculateAverageProfitRate();
    
    document.getElementById('totalProfit').textContent = formatCurrency(totalProfit);
    document.getElementById('monthlyProfit').textContent = formatCurrency(monthlyProfit);
    document.getElementById('totalPurchaseAmount').textContent = formatCurrency(totalPurchaseAmount);
    document.getElementById('totalItems').textContent = totalItems;
    document.getElementById('inventoryCount').textContent = inventoryCount;
    document.getElementById('avgProfitRate').textContent = avgProfitRate.toFixed(1) + '%';
}

// 총 수익 계산
function calculateTotalProfit() {
    return transactions
        .filter(t => t.type === 'sale' && t.profit)
        .reduce((sum, t) => sum + t.profit, 0);
}

// 이번달 수익 계산
function calculateMonthlyProfit() {
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    
    return transactions
        .filter(t => {
            const transactionDate = new Date(t.date);
            return t.type === 'sale' && 
                   t.profit && 
                   transactionDate.getMonth() === currentMonth &&
                   transactionDate.getFullYear() === currentYear;
        })
        .reduce((sum, t) => sum + t.profit, 0);
}

// 총 매입 금액 계산
function calculateTotalPurchaseAmount() {
    const purchases = transactions.filter(t => t.type === 'purchase');
    return purchases.reduce((sum, t) => sum + t.price, 0);
}

// 기종별 평균 매입가 계산
function calculateAveragePurchasePriceByModel(model) {
    const purchases = transactions.filter(t => 
        t.type === 'purchase' && 
        t.model.toLowerCase().includes(model.toLowerCase())
    );
    
    if (purchases.length === 0) return 0;
    
    const totalPurchasePrice = purchases.reduce((sum, t) => sum + t.price, 0);
    return Math.round(totalPurchasePrice / purchases.length);
}

// 재고 수량 계산
function calculateInventoryCount() {
    const purchases = transactions.filter(t => t.type === 'purchase');
    const soldItems = transactions.filter(t => t.type === 'sale' && t.purchaseId);
    return purchases.length - soldItems.length;
}

// 평균 수익률 계산
function calculateAverageProfitRate() {
    const sales = transactions.filter(t => t.type === 'sale' && t.profit);
    if (sales.length === 0) return 0;
    
    const totalProfitRate = sales.reduce((sum, t) => {
        const purchase = transactions.find(p => p.id === t.purchaseId);
        if (purchase) {
            return sum + (t.profit / purchase.price * 100);
        }
        return sum;
    }, 0);
    
    return totalProfitRate / sales.length;
}

// 재고 목록 업데이트
function updateInventory() {
    const tbody = document.getElementById('inventoryTableBody');
    tbody.innerHTML = '';
    
    const inventory = getInventoryItems();
    const totalValue = inventory.reduce((sum, item) => sum + item.price, 0);
    
    document.getElementById('totalInventoryValue').textContent = formatCurrency(totalValue);
    
    inventory.forEach(item => {
        const row = document.createElement('tr');
        const holdingDays = Math.floor((new Date() - new Date(item.date)) / (1000 * 60 * 60 * 24));
        
        row.innerHTML = `
            <td>${formatDate(item.date)}</td>
            <td>${item.model}</td>
            <td>${item.storage || '-'}</td>
            <td>${item.color || '-'}</td>
            <td>${formatCurrency(item.price)}</td>
            <td>${item.dealer || '-'}</td>
            <td>${holdingDays}일</td>
            <td>${item.memo || '-'}</td>
            <td>
                <button class="btn btn-sm btn-success" onclick="sellFromPurchase(${item.id})">
                    <i class="fas fa-shopping-cart"></i> 판매
                </button>
            </td>
        `;
        
        tbody.appendChild(row);
    });
}

// 재고 아이템 가져오기
function getInventoryItems() {
    const purchases = transactions.filter(t => t.type === 'purchase');
    const soldItems = transactions.filter(t => t.type === 'sale' && t.purchaseId);
    const soldIds = soldItems.map(t => t.purchaseId);
    
    return purchases.filter(p => !soldIds.includes(p.id));
}

// 재고 검색 필터링
function filterInventory() {
    const searchTerm = document.getElementById('inventorySearch').value.toLowerCase();
    const rows = document.querySelectorAll('#inventoryTableBody tr');
    
    rows.forEach(row => {
        const model = row.querySelector('td:nth-child(2)').textContent.toLowerCase();
        const storage = row.querySelector('td:nth-child(3)').textContent.toLowerCase();
        const color = row.querySelector('td:nth-child(4)').textContent.toLowerCase();
        const dealer = row.querySelector('td:nth-child(6)').textContent.toLowerCase();
        const memo = row.querySelector('td:nth-child(8)').textContent.toLowerCase();
        
        const matchesSearch = model.includes(searchTerm) || 
                            storage.includes(searchTerm) || 
                            color.includes(searchTerm) || 
                            dealer.includes(searchTerm) || 
                            memo.includes(searchTerm);
        
        row.style.display = matchesSearch ? '' : 'none';
    });
}

// 수익률 분석 업데이트
function updateAnalytics() {
    updateModelProfitRanking();
    updateMonthlyProfitRate();
}

// 기종별 수익률 순위 업데이트
function updateModelProfitRanking() {
    const container = document.getElementById('modelProfitRanking');
    const modelStats = calculateModelProfitStats();
    
    if (modelStats.length === 0) {
        container.innerHTML = '<p class="text-muted">판매 데이터가 없습니다.</p>';
        return;
    }
    
    let html = '<div class="list-group list-group-flush">';
    modelStats.forEach((stat, index) => {
        const profitRateClass = stat.profitRate >= 0 ? 'text-success' : 'text-danger';
        const rankIcon = index < 3 ? ['🥇', '🥈', '🥉'][index] : `${index + 1}.`;
        
        html += `
            <div class="list-group-item d-flex justify-content-between align-items-center">
                <div>
                    <strong>${rankIcon} ${stat.model}</strong>
                    <br><small class="text-muted">${stat.salesCount}건 판매</small>
                </div>
                <div class="text-end">
                    <div class="${profitRateClass} fw-bold">${stat.profitRate.toFixed(1)}%</div>
                    <small class="text-muted">${formatCurrency(stat.totalProfit)}</small>
                </div>
            </div>
        `;
    });
    html += '</div>';
    
    container.innerHTML = html;
}

// 기종별 수익 통계 계산
function calculateModelProfitStats() {
    const modelStats = {};
    
    transactions
        .filter(t => t.type === 'sale' && t.profit)
        .forEach(t => {
            const model = t.model;
            if (!modelStats[model]) {
                modelStats[model] = {
                    model: model,
                    totalProfit: 0,
                    totalPurchasePrice: 0,
                    salesCount: 0
                };
            }
            
            modelStats[model].totalProfit += t.profit;
            modelStats[model].salesCount += 1;
            
            const purchase = transactions.find(p => p.id === t.purchaseId);
            if (purchase) {
                modelStats[model].totalPurchasePrice += purchase.price;
            }
        });
    
    return Object.values(modelStats)
        .map(stat => ({
            ...stat,
            profitRate: stat.totalPurchasePrice > 0 ? (stat.totalProfit / stat.totalPurchasePrice * 100) : 0
        }))
        .sort((a, b) => b.profitRate - a.profitRate);
}

// 월별 수익률 업데이트
function updateMonthlyProfitRate() {
    const container = document.getElementById('monthlyProfitRate');
    const monthlyStats = calculateMonthlyProfitStats();
    
    if (monthlyStats.length === 0) {
        container.innerHTML = '<p class="text-muted">판매 데이터가 없습니다.</p>';
        return;
    }
    
    let html = '<div class="list-group list-group-flush">';
    monthlyStats.forEach(stat => {
        const profitRateClass = stat.profitRate >= 0 ? 'text-success' : 'text-danger';
        
        html += `
            <div class="list-group-item d-flex justify-content-between align-items-center">
                <div>
                    <strong>${stat.month}</strong>
                    <br><small class="text-muted">${stat.salesCount}건 판매</small>
                </div>
                <div class="text-end">
                    <div class="${profitRateClass} fw-bold">${stat.profitRate.toFixed(1)}%</div>
                    <small class="text-muted">${formatCurrency(stat.totalProfit)}</small>
                </div>
            </div>
        `;
    });
    html += '</div>';
    
    container.innerHTML = html;
}

// 월별 수익 통계 계산
function calculateMonthlyProfitStats() {
    const monthlyStats = {};
    
    transactions
        .filter(t => t.type === 'sale' && t.profit)
        .forEach(t => {
            const date = new Date(t.date);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            const monthLabel = `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
            
            if (!monthlyStats[monthKey]) {
                monthlyStats[monthKey] = {
                    month: monthLabel,
                    totalProfit: 0,
                    totalPurchasePrice: 0,
                    salesCount: 0
                };
            }
            
            monthlyStats[monthKey].totalProfit += t.profit;
            monthlyStats[monthKey].salesCount += 1;
            
            const purchase = transactions.find(p => p.id === t.purchaseId);
            if (purchase) {
                monthlyStats[monthKey].totalPurchasePrice += purchase.price;
            }
        });
    
    return Object.values(monthlyStats)
        .map(stat => ({
            ...stat,
            profitRate: stat.totalPurchasePrice > 0 ? (stat.totalProfit / stat.totalPurchasePrice * 100) : 0
        }))
        .sort((a, b) => {
            const yearA = a.month.split('년 ')[0];
            const monthA = a.month.split('년 ')[1].replace('월', '');
            const yearB = b.month.split('년 ')[0];
            const monthB = b.month.split('년 ')[1].replace('월', '');
            return new Date(yearB, monthB - 1) - new Date(yearA, monthA - 1);
        });
}

// 테이블 업데이트
function updateTable() {
    const tbody = document.getElementById('transactionTableBody');
    tbody.innerHTML = '';
    
    const sortedTransactions = transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    sortedTransactions.forEach(transaction => {
        const row = document.createElement('tr');
        
        const profit = transaction.type === 'sale' && transaction.profit ? transaction.profit : null;
        const profitClass = profit ? (profit >= 0 ? 'profit-positive' : 'profit-negative') : '';
        
        row.innerHTML = `
            <td>${formatDate(transaction.date)}</td>
            <td>
                <span class="status-badge ${transaction.type === 'purchase' ? 'status-purchased' : 'status-sold'}">
                    ${transaction.type === 'purchase' ? '매입' : '판매'}
                </span>
            </td>
            <td>${transaction.model}</td>
            <td class="d-none d-md-table-cell">${transaction.storage || '-'}</td>
            <td class="d-none d-md-table-cell">${transaction.color || '-'}</td>
            <td>${formatCurrency(transaction.price)}</td>
            <td class="d-none d-md-table-cell">${transaction.dealer || '-'}</td>
            <td class="d-none d-md-table-cell">${transaction.memo || '-'}</td>
            <td class="${profitClass}">${profit ? formatCurrency(profit) : '-'}</td>
            <td>
                <button class="btn btn-sm btn-outline-primary me-1" onclick="editTransaction(${transaction.id})">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteTransaction(${transaction.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
            <td>
                ${transaction.type === 'purchase' && !transactions.some(t => t.purchaseId === transaction.id) ? 
                    `<button class="btn btn-sm btn-success" onclick="sellFromPurchase(${transaction.id})">
                        <i class="fas fa-shopping-cart"></i> 판매
                    </button>` : 
                    '-'
                }
            </td>
        `;
        
        tbody.appendChild(row);
    });
}

// 거래 삭제
function deleteTransaction(id) {
    if (confirm('정말로 이 거래를 삭제하시겠습니까?')) {
        transactions = transactions.filter(t => t.id !== id);
        saveData();
        updateStats();
        updateTable();
        updateInventory();
        updateAnalytics();
        showAlert('거래가 삭제되었습니다.', 'info');
    }
}

// 매입 제품에서 판매 등록
function sellFromPurchase(purchaseId) {
    const purchase = transactions.find(t => t.id === purchaseId);
    if (!purchase) return;
    
    // 폼에 매입 정보 자동 입력
    document.getElementById('transactionType').value = 'sale';
    document.getElementById('phoneModel').value = purchase.model;
    document.getElementById('storage').value = purchase.storage || '';
    document.getElementById('color').value = purchase.color || '';
    document.getElementById('dealer').value = '';
    document.getElementById('memo').value = '';
    
    // 폼으로 스크롤
    document.getElementById('transactionForm').scrollIntoView({ behavior: 'smooth' });
    
    // 가격 입력란에 포커스
    document.getElementById('price').focus();
    
    showAlert(`${purchase.model} 판매 정보를 입력해주세요.`, 'info');
}

// 거래 수정 모드 시작
function editTransaction(id) {
    const transaction = transactions.find(t => t.id === id);
    if (!transaction) return;
    
    editingTransactionId = id;
    
    // 폼에 기존 데이터 입력
    document.getElementById('transactionType').value = transaction.type;
    document.getElementById('phoneModel').value = transaction.model;
    document.getElementById('storage').value = transaction.storage || '';
    document.getElementById('color').value = transaction.color || '';
    document.getElementById('price').value = transaction.price;
    document.getElementById('transactionDate').value = transaction.date;
    document.getElementById('dealer').value = transaction.dealer || '';
    document.getElementById('memo').value = transaction.memo || '';
    
    // 버튼 텍스트 변경
    const submitBtn = document.querySelector('#transactionForm button[type="submit"]');
    submitBtn.innerHTML = '<i class="fas fa-save me-2"></i>수정';
    submitBtn.classList.remove('btn-primary');
    submitBtn.classList.add('btn-warning');
    
    // 취소 버튼 표시
    document.getElementById('cancelBtn').style.display = 'inline-block';
    
    // 폼으로 스크롤
    document.getElementById('transactionForm').scrollIntoView({ behavior: 'smooth' });
    
    showAlert(`${transaction.model} 거래를 수정 중입니다.`, 'info');
}

// 수정 모드 취소
function cancelEdit() {
    editingTransactionId = null;
    
    // 폼 초기화
    document.getElementById('transactionForm').reset();
    setDefaultDate();
    
    // 버튼 텍스트 복원
    const submitBtn = document.querySelector('#transactionForm button[type="submit"]');
    submitBtn.innerHTML = '<i class="fas fa-save me-2"></i>저장';
    submitBtn.classList.remove('btn-warning');
    submitBtn.classList.add('btn-primary');
    
    // 취소 버튼 숨김
    document.getElementById('cancelBtn').style.display = 'none';
    
    showAlert('수정이 취소되었습니다.', 'info');
}

// 거래 유형 변경 처리
function handleTransactionTypeChange() {
    const transactionType = document.getElementById('transactionType').value;
    const matchingSection = document.getElementById('matchingSection');
    
    if (transactionType === 'sale' && !editingTransactionId) {
        // 판매 선택 시 매칭 옵션 표시
        showMatchingOptions();
    } else {
        // 매입이거나 수정 모드일 때는 숨김
        matchingSection.style.display = 'none';
        selectedPurchaseId = null;
    }
}

// 매칭 옵션 표시
function showMatchingOptions() {
    const matchingSection = document.getElementById('matchingSection');
    const matchingOptions = document.getElementById('matchingOptions');
    
    // 이미 판매된 매입은 제외
    const soldPurchaseIds = transactions
        .filter(t => t.type === 'sale' && t.purchaseId)
        .map(t => t.purchaseId);
    
    const availablePurchases = transactions.filter(t => 
        t.type === 'purchase' && 
        !soldPurchaseIds.includes(t.id)
    );
    
    if (availablePurchases.length === 0) {
        matchingOptions.innerHTML = '<p class="text-muted">매칭할 수 있는 매입이 없습니다.</p>';
    } else {
        let html = '<div class="row">';
        availablePurchases.forEach(purchase => {
            const isSelected = selectedPurchaseId === purchase.id;
            html += `
                <div class="col-md-6 mb-2">
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="purchaseMatch" 
                               id="purchase_${purchase.id}" value="${purchase.id}" 
                               ${isSelected ? 'checked' : ''} 
                               onchange="selectPurchase(${purchase.id})">
                        <label class="form-check-label" for="purchase_${purchase.id}">
                            <strong>${purchase.model}</strong><br>
                            <small class="text-muted">
                                매입가: ${formatCurrency(purchase.price)} | 
                                날짜: ${formatDate(purchase.date)}
                            </small>
                        </label>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        matchingOptions.innerHTML = html;
    }
    
    matchingSection.style.display = 'block';
}

// 매입 선택
function selectPurchase(purchaseId) {
    selectedPurchaseId = purchaseId;
    console.log('선택된 매입 ID:', purchaseId);
    
    // 선택된 매입 정보를 폼에 자동 입력
    const selectedPurchase = transactions.find(p => p.id === purchaseId);
    if (selectedPurchase) {
        document.getElementById('phoneModel').value = selectedPurchase.model;
        document.getElementById('storage').value = selectedPurchase.storage || '';
        document.getElementById('color').value = selectedPurchase.color || '';
        document.getElementById('dealer').value = selectedPurchase.dealer || '';
        document.getElementById('memo').value = selectedPurchase.memo || '';
        
        console.log('매칭된 매입 정보 입력됨:', {
            model: selectedPurchase.model,
            storage: selectedPurchase.storage,
            color: selectedPurchase.color,
            price: selectedPurchase.price
        });
    }
}

// 거래 필터링
function filterTransactions() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const statusFilter = document.getElementById('statusFilter').value;
    
    const rows = document.querySelectorAll('#transactionTableBody tr');
    
    rows.forEach(row => {
        const type = row.querySelector('td:nth-child(2)').textContent.trim();
        const model = row.querySelector('td:nth-child(3)').textContent.toLowerCase();
        const dealer = row.querySelector('td:nth-child(7)').textContent.toLowerCase();
        const memo = row.querySelector('td:nth-child(8)').textContent.toLowerCase();
        
        const matchesSearch = model.includes(searchTerm) || 
                            dealer.includes(searchTerm) || 
                            memo.includes(searchTerm);
        
        const matchesStatus = statusFilter === 'all' || 
                            (statusFilter === 'purchase' && type === '매입') ||
                            (statusFilter === 'sale' && type === '판매');
        
        row.style.display = (matchesSearch && matchesStatus) ? '' : 'none';
    });
}



// 데이터 저장 (클라우드 + 로컬)
async function saveData() {
    // 로컬 저장
    localStorage.setItem('phoneTransactions', JSON.stringify(transactions));
    
    // 클라우드 저장
    if (isCloudSyncEnabled && db) {
        try {
            await db.collection('phoneTransactions').doc('userData').set({
                transactions: transactions,
                lastUpdated: new Date().toISOString()
            });
            console.log('클라우드 저장 성공!');
        } catch (error) {
            console.error('클라우드 저장 실패:', error);
        }
    }
}

// 데이터 로드 (클라우드 우선, 로컬 백업)
async function loadData() {
    if (isCloudSyncEnabled && db) {
        try {
            const doc = await db.collection('phoneTransactions').doc('userData').get();
            if (doc.exists) {
                transactions = doc.data().transactions || [];
                console.log('클라우드에서 데이터 로드 성공!');
                return;
            }
        } catch (error) {
            console.error('클라우드 로드 실패, 로컬에서 로드:', error);
        }
    }
    
    // 로컬에서 로드
    const saved = localStorage.getItem('phoneTransactions');
    if (saved) {
        transactions = JSON.parse(saved);
        console.log('로컬에서 데이터 로드');
    }
}

// 데이터 내보내기
function exportData() {
    const csvContent = generateCSV();
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `중고아이폰_거래내역_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

// 데이터 가져오기
function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = function(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    parseAndLoadCSV(e.target.result);
                    showAlert('데이터가 성공적으로 가져와졌습니다!', 'success');
                } catch (error) {
                    showAlert('파일 형식이 올바르지 않습니다.', 'danger');
                    console.error('CSV 파싱 오류:', error);
                }
            };
            reader.readAsText(file);
        }
    };
    input.click();
}

// URL에서 직접 CSV 가져오기 (GitHub 등에서)
function importFromURL() {
    const url = prompt('CSV 파일의 URL을 입력하세요 (GitHub raw 파일 링크):');
    if (url) {
        fetch(url)
            .then(response => response.text())
            .then(csvContent => {
                try {
                    parseAndLoadCSV(csvContent);
                    showAlert('URL에서 데이터가 성공적으로 가져와졌습니다!', 'success');
                } catch (error) {
                    showAlert('URL에서 파일을 가져오는데 실패했습니다.', 'danger');
                    console.error('URL 가져오기 오류:', error);
                }
            })
            .catch(error => {
                showAlert('URL에 접근할 수 없습니다.', 'danger');
                console.error('URL 접근 오류:', error);
            });
    }
}

// CSV 파싱 및 데이터 로드
function parseAndLoadCSV(csvContent) {
    const lines = csvContent.split('\n');
    const headers = lines[0].split(',').map(h => h.replace(/"/g, ''));
    
    const newTransactions = [];
    
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '') continue;
        
        const values = lines[i].split(',').map(v => v.replace(/"/g, ''));
        const transaction = {
            id: Date.now() + i, // 새로운 ID 생성
            type: values[1] === '매입' ? 'purchase' : 'sale',
            model: values[2],
            storage: values[3] || '',
            color: values[4] || '',
            price: parseInt(values[5]) || 0,
            date: values[0],
            dealer: values[6] || '',
            memo: values[7] || '',
            timestamp: new Date().toISOString()
        };
        
        // 수익 정보가 있으면 추가
        if (values[8] && values[8] !== '') {
            transaction.profit = parseInt(values[8]);
        }
        
        newTransactions.push(transaction);
    }
    
    // 기존 데이터와 병합
    transactions = [...transactions, ...newTransactions];
    
    // 데이터 저장 및 화면 업데이트
    saveData();
    updateStats();
    updateTable();
    updateInventory();
    updateAnalytics();
}

// CSV 생성
function generateCSV() {
    const headers = ['날짜', '유형', '모델', '용량', '색상', '가격', '거래처', '메모', '수익'];
    const rows = [headers];
    
    transactions
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .forEach(t => {
            const profit = t.type === 'sale' && t.profit ? t.profit : '';
            rows.push([
                t.date,
                t.type === 'purchase' ? '매입' : '판매',
                t.model,
                t.storage || '',
                t.color || '',
                t.price,
                t.dealer || '',
                t.memo || '',
                profit
            ]);
        });
    
    return rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
}

// 유틸리티 함수들
function formatCurrency(amount) {
    return '₩' + amount.toLocaleString();
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('ko-KR');
}

function showAlert(message, type = 'info') {
    // 간단한 알림 표시 (실제로는 더 정교한 알림 시스템을 사용할 수 있습니다)
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
    alertDiv.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(alertDiv);
    
    // 3초 후 자동 제거
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.parentNode.removeChild(alertDiv);
        }
    }, 3000);
}

// 추천 매입가 계산 기능
function calculateRecommendedPurchasePrice(model) {
    const modelSales = transactions.filter(t => 
        t.type === 'sale' && 
        t.model.toLowerCase().includes(model.toLowerCase()) &&
        t.profit
    );
    
    if (modelSales.length === 0) return null;
    
    const avgSalePrice = modelSales.reduce((sum, t) => sum + t.price, 0) / modelSales.length;
    const avgProfit = modelSales.reduce((sum, t) => sum + t.profit, 0) / modelSales.length;
    const avgPurchasePrice = calculateAveragePurchasePriceByModel(model);
    
    // 평균 수익의 70%를 목표 수익으로 설정하여 추천 매입가 계산
    const targetProfit = avgProfit * 0.7;
    const recommendedPrice = Math.round(avgSalePrice - targetProfit);
    
    return {
        recommendedPrice,
        avgSalePrice: Math.round(avgSalePrice),
        avgProfit: Math.round(avgProfit),
        avgPurchasePrice: avgPurchasePrice,
        salesCount: modelSales.length
    };
}

// 추천 매입가 표시 함수 (필요시 사용)
function showRecommendedPrice(model) {
    const recommendation = calculateRecommendedPurchasePrice(model);
    if (recommendation) {
        const message = `
            ${model} 추천 매입가: ${formatCurrency(recommendation.recommendedPrice)}
            (평균 판매가: ${formatCurrency(recommendation.avgSalePrice)}, 
            평균 매입가: ${formatCurrency(recommendation.avgPurchasePrice)},
            평균 수익: ${formatCurrency(recommendation.avgProfit)}, 
            판매 건수: ${recommendation.salesCount}건)
        `;
        showAlert(message, 'info');
    } else {
        showAlert('해당 모델의 판매 데이터가 없습니다.', 'warning');
    }
} 